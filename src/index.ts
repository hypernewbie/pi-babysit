/**
 * pi-babysit — periodic read-only drift health check for Pi sessions.
 *
 * A separately configured (cheaper) model judges whether the active session
 * still aligns with the user's original intent and explicit rules. Advisory
 * only: it notifies, it never steers, edits, or injects messages.
 *
 * Automatic checks: `tool_execution_end` counts completed tools; when the
 * threshold is crossed a check becomes pending and runs (awaited) at the next
 * `turn_end`, after Pi has persisted the current tool results and before it
 * prepares the next model turn.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type {
	AgentSettledEvent,
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	SessionShutdownEvent,
	SessionStartEvent,
	ToolExecutionEndEvent,
	TurnEndEvent,
} from "@earendil-works/pi-coding-agent";

import { parseCommand } from "./command.ts";
import { DEFAULT_CONFIG, mergeConfig, type BabysitConfig } from "./config.ts";
import { log, logError, notify } from "./display.ts";
import {
	dedupeReferences,
	loadReference,
	type LoadedReference,
} from "./file-references.ts";
import { buildStablePrefix, hashStablePrefix } from "./prefix.ts";
import { buildActivityTail, contentText, type ActivityEntry } from "./activity.ts";
import { runModelCheck, type ModelRegistryCtx } from "./model-check.ts";
import { ToolCounter } from "./scheduler.ts";
import { emptyUsage, type BabysitState, type BabysitVerdict } from "./types.ts";

const CUSTOM_ENTRY_TYPE = "babysit-check";
const INTENT_MAX_CHARS = 4000;
const DEFAULT_CACHE_RETENTION = "short";

interface Babysitter {
	config: BabysitConfig;
	state: BabysitState;
	counter: ToolCounter;
	/** Reference cache keyed by absolute path. */
	refCache: Map<string, { mtimeMs: number; size: number; loaded: LoadedReference }>;
}

function createBabysitter(config: BabysitConfig): Babysitter {
	return {
		config,
		state: {
			enabled: config.enabled,
			everyToolCalls: config.everyToolCalls,
			toolCallsSinceCheck: 0,
			pendingCheck: false,
			checkInFlight: false,
			checkCount: 0,
			referencedFiles: [],
			usage: emptyUsage(),
		},
		counter: new ToolCounter(config.everyToolCalls),
		refCache: new Map(),
	};
}

/** Load `.pi/babysit.json` from the project root, if present. */
function loadProjectConfig(cwd: string): Partial<BabysitConfig> | undefined {
	const file = path.join(cwd, ".pi", "babysit.json");
	try {
		if (!fs.existsSync(file)) return undefined;
		const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
		const out: Partial<BabysitConfig> = {};
		for (const key of Object.keys(DEFAULT_CONFIG) as (keyof BabysitConfig)[]) {
			const v = raw[key];
			if (v !== undefined && v !== null) (out as Record<string, unknown>)[key] = v;
		}
		return out;
	} catch (err) {
		logError(`could not read ${file}: ${err instanceof Error ? err.message : String(err)}`);
		return undefined;
	}
}

/** Extract the first user message on the branch as the baseline intent. */
function captureIntent(entries: ActivityEntry[]): string {
	for (const entry of entries) {
		if (entry.type !== "message") continue;
		const msg = entry.message;
		if (msg?.role !== "user") continue;
		const text = contentText(msg.content).trim();
		if (text) return text.length > INTENT_MAX_CHARS ? text.slice(0, INTENT_MAX_CHARS) + "…" : text;
	}
	return "";
}

/** Load reference files (config rules + command refs), cached by mtime/size. */
function loadReferences(
	babysitter: Babysitter,
	cwd: string,
	commandRefs: string[],
): { refs: LoadedReference[]; error?: string } {
	const all = dedupeReferences([...babysitter.config.rules, ...commandRefs], cwd);
	const loaded: LoadedReference[] = [];
	let total = 0;

	for (const ref of all) {
		const abs = path.isAbsolute(ref) ? ref : path.resolve(cwd, ref);
		let stat: fs.Stats;
		try {
			stat = fs.statSync(abs);
		} catch {
			return { refs: loaded, error: `referenced file not found: ${abs}` };
		}
		if (!stat.isFile()) return { refs: loaded, error: `referenced path is not a file: ${abs}` };

		const cached = babysitter.refCache.get(abs);
		if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
			loaded.push(cached.loaded);
		} else {
			try {
				const loadedRef = loadReference(abs, babysitter.config.maxFileBytes);
				babysitter.refCache.set(abs, { mtimeMs: stat.mtimeMs, size: stat.size, loaded: loadedRef });
				loaded.push(loadedRef);
			} catch (err) {
				return { refs: loaded, error: err instanceof Error ? err.message : String(err) };
			}
		}
		total += loaded[loaded.length - 1]!.size;
		if (total > babysitter.config.maxTotalRefBytes) {
			return { refs: loaded, error: `total reference size exceeds ${babysitter.config.maxTotalRefBytes} bytes` };
		}
	}

	return { refs: loaded };
}

function modelId(babysitter: Babysitter): string {
	return babysitter.config.model || babysitter.state.modelId || "";
}

/** Assemble the dynamic activity prompt (header + bounded tail). */
function buildActivityPrompt(tail: string, toolsSinceCheck: number, truncated: boolean, tailTokens: number): string {
	const lines: string[] = [
		`Recent session activity (${tailTokens} estimated tokens; oldest entries may be dropped):`,
		`Tools executed since the last check: ${toolsSinceCheck}`,
		"",
		tail,
	];
	if (truncated) lines.push("", "(some tool results were truncated)");
	return lines.join("\n");
}

/**
 * Run one check. Concurrency-guarded: a second call while one is in flight
 * is a no-op. `fromCounter` is true for automatic turn_end checks.
 */
async function runCheck(
	babysitter: Babysitter,
	ctx: ModelRegistryCtx & {
		cwd: string;
		sessionManager: {
			getSessionId(): string;
			getLeafId(): string | null;
			getBranch(): ActivityEntry[];
			buildContextEntries(): ActivityEntry[];
		};
		hasUI: boolean;
		ui: { notify(message: string, type?: "info" | "warning" | "error"): void };
		signal?: AbortSignal;
	},
	opts: { refs?: string[]; model?: string; fromCounter: boolean; appendEntry: (type: string, data: unknown) => void },
): Promise<void> {
	const st = babysitter.state;
	if (st.checkInFlight) {
		notify(ctx, "A babysitter check is already running.", "info");
		return;
	}
	if (opts.model) babysitter.config.model = opts.model;
	const mid = modelId(babysitter);
	if (!mid) {
		notify(ctx, "No babysitter model configured. Use --model provider/model-id or .pi/babysit.json.", "error");
		return;
	}

	st.checkInFlight = true;
	const started = Date.now();
	try {
		const sessionId = ctx.sessionManager.getSessionId() || "unknown";
		const leafId = ctx.sessionManager.getLeafId() ?? undefined;

		// Baseline intent: capture once per session.
		if (!st.intent) {
			st.intent = captureIntent(ctx.sessionManager.getBranch());
		}

		// Reference files (config rules + per-command refs).
		const { refs, error: refError } = loadReferences(babysitter, ctx.cwd, opts.refs ?? []);
		if (refError) {
			notify(ctx, `babysit: ${refError}`, "error");
			return;
		}
		st.referencedFiles = refs.map((r) => r.absPath);

		// Stable prefix.
		const prefixInputs = {
			modelId: mid,
			intent: st.intent || "(no user intent captured yet)",
			references: refs,
			everyToolCalls: babysitter.config.everyToolCalls,
			tailTokens: babysitter.config.tailTokens,
		};
		const prefix = buildStablePrefix(prefixInputs);
		const prefixHash = hashStablePrefix(prefixInputs);
		const prefixChanged = st.prefixHash !== undefined && st.prefixHash !== prefixHash;
		st.prefixHash = prefixHash;

		// Dynamic tail from the active session context.
		const tailOpts = {
			maxChars: babysitter.config.tailTokens * 4,
			maxToolResultChars: babysitter.config.maxToolResultChars,
			maxToolResults: babysitter.config.maxToolResults,
		};
		const tail = buildActivityTail(ctx.sessionManager.buildContextEntries() as ActivityEntry[], tailOpts);
		const activityPrompt = buildActivityPrompt(tail.text, babysitter.counter.count, tail.truncated, babysitter.config.tailTokens);

		// Combined abort: active agent signal + session shutdown controller.
		const signals: AbortSignal[] = [];
		if (ctx.signal) signals.push(ctx.signal);
		if (st.abortController) signals.push(st.abortController.signal);
		const signal = signals.length > 0 ? AbortSignal.any(signals) : undefined;

		const result = await runModelCheck(ctx, {
			modelId: mid,
			systemPrompt: prefix,
			activityPrompt,
			signal,
			sessionId: `babysit:${sessionId}`,
			cacheRetention: DEFAULT_CACHE_RETENTION,
		});

		const durationMs = Date.now() - started;
		st.usage = addUsage(st.usage, result.usage);

		if (!result.ok) {
			st.lastCheckError = result.error;
			notify(ctx, `babysit check failed: ${result.error}`, "error");
			if (opts.fromCounter) babysitter.counter.finishCheck();
			return;
		}

		const verdict = result.verdict!;
		st.lastVerdict = verdict;
		st.lastCheckError = undefined;
		st.lastCheckAt = Date.now();
		st.lastCheckedLeafId = leafId;
		st.checkCount++;

		reportVerdict(ctx, verdict, mid, st.checkCount, result.usage, durationMs, prefixChanged);
		if (babysitter.config.persistVerdicts) {
			opts.appendEntry(CUSTOM_ENTRY_TYPE, {
				verdict,
				checkIndex: st.checkCount,
				modelId: mid,
				usage: result.usage,
				durationMs,
				ts: st.lastCheckAt,
			});
		}
		if (opts.fromCounter) babysitter.counter.finishCheck();
	} finally {
		st.checkInFlight = false;
	}
}

function addUsage(a: { input: number; output: number; cacheRead: number; cacheWrite: number; cost: number }, b: typeof a) {
	return {
		input: a.input + b.input,
		output: a.output + b.output,
		cacheRead: a.cacheRead + b.cacheRead,
		cacheWrite: a.cacheWrite + b.cacheWrite,
		cost: a.cost + b.cost,
	};
}

function reportVerdict(
	ctx: { hasUI: boolean; ui: { notify(message: string, type?: "info" | "warning" | "error"): void } },
	verdict: BabysitVerdict,
	modelId: string,
	checkIndex: number,
	usage: { cacheRead: number; cacheWrite: number },
	durationMs: number,
	prefixChanged: boolean,
): void {
	const { status } = verdict;
	const summary = verdict.summary.replace(/\s+/g, " ").trim();
	const cacheLine = `cache read=${usage.cacheRead} write=${usage.cacheWrite}${prefixChanged ? " (prefix changed)" : ""}`;

	if (status === "on_track") {
		notify(ctx, `babysit on_track (${modelId}): ${summary}`, "info");
	} else if (status === "concern") {
		notify(ctx, `babysit concern (${modelId}): ${summary}`, "warning");
	} else if (status === "off_track") {
		const evidence = verdict.evidence.slice(0, 3).map((e) => `- ${e}`).join("\n");
		const msg = `babysit off_track (${modelId}): ${summary}${evidence ? `\n${evidence}` : ""}\nRecommendation: ${verdict.recommendation}`;
		notify(ctx, msg, "warning");
	} else {
		notify(ctx, `babysit unclear (${modelId}): ${summary}`, "info");
	}
	log(`check #${checkIndex} ${status} in ${durationMs}ms (${modelId}) — ${cacheLine}`);
}

function statusReport(babysitter: Babysitter): string {
	const st = babysitter.state;
	const lines = [
		`babysit status`,
		`  enabled: ${st.enabled} (every ${babysitter.counter.every} tool executions)`,
		`  model: ${modelId(babysitter) || "(not configured)"}`,
		`  counter: ${babysitter.counter.count}/${babysitter.counter.every} (pending=${babysitter.counter.pending})`,
		`  checks run: ${st.checkCount}`,
		`  usage: in=${st.usage.input} out=${st.usage.output} cacheRead=${st.usage.cacheRead} cacheWrite=${st.usage.cacheWrite} cost=${st.usage.cost.toFixed(4)}`,
		`  prefix hash: ${st.prefixHash ?? "(not built yet)"}`,
	];
	if (st.lastVerdict) {
		lines.push(`  last verdict: ${st.lastVerdict.status} (conf ${st.lastVerdict.confidence}) — ${st.lastVerdict.summary.replace(/\s+/g, " ").trim()}`);
		lines.push(`  last recommendation: ${st.lastVerdict.recommendation.replace(/\s+/g, " ").trim()}`);
	}
	if (st.lastCheckError) lines.push(`  last error: ${st.lastCheckError}`);
	return lines.join("\n");
}

export default function babysitExtension(pi: ExtensionAPI): void {
	let babysitter: Babysitter = createBabysitter(DEFAULT_CONFIG);

	function rebind(ctx: { cwd: string; sessionManager: { getSessionId(): string } }): void {
		const merged = mergeConfig(DEFAULT_CONFIG, loadProjectConfig(ctx.cwd));
		babysitter = createBabysitter(merged);
		babysitter.state.activeSessionId = ctx.sessionManager.getSessionId() || "unknown";
	}

	pi.on("session_start", (event: SessionStartEvent, ctx: ExtensionContext) => {
		rebind(ctx);
		log(`session_start (${event.reason}); babysitter ${babysitter.config.enabled ? "enabled" : "disabled"}`);
	});

	pi.on("session_shutdown", (_event: SessionShutdownEvent, _ctx: ExtensionContext) => {
		// Abort any in-flight check so we never write into a dying session.
		babysitter.state.abortController?.abort();
		babysitter.counter.releaseInFlight();
	});

	pi.on("tool_execution_end", (_event: ToolExecutionEndEvent, ctx: ExtensionContext) => {
		if (!babysitter.state.enabled) return;
		// Only count tools from the active session we are babysitting.
		if (ctx.sessionManager.getSessionId() !== babysitter.state.activeSessionId) return;
		babysitter.counter.countTool();
	});

	pi.on("turn_end", async (_event: TurnEndEvent, ctx: ExtensionContext) => {
		if (!babysitter.state.enabled) return;
		if (!babysitter.counter.pending || babysitter.counter.inFlight) return;
		// Awaited: Pi waits for extension handlers before preparing the next
		// model turn, so the check sees a coherent, persisted snapshot.
		await runCheck(babysitter, ctx, {
			fromCounter: true,
			appendEntry: (type, data) => pi.appendEntry(type, data),
		});
	});

	// Optional lower-latency-insensitive "check after run" mode: fires only
	// after the entire agent run (retries, compaction retries, queued
	// continuations) has settled.
	pi.on("agent_settled", async (_event: AgentSettledEvent, ctx: ExtensionContext) => {
		if (!babysitter.state.enabled) return;
		if (!babysitter.config.runAfterSettle) return;
		if (!babysitter.counter.pending || babysitter.counter.inFlight) return;
		await runCheck(babysitter, ctx, {
			fromCounter: true,
			appendEntry: (type, data) => pi.appendEntry(type, data),
		});
	});

	pi.registerCommand("babysit", {
		description:
			"Periodic read-only drift health check. Usage: /babysit [now|on|off|status] [--every N] [--model provider/model] [--tail-tokens N] [@file/...]",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const parsed = parseCommand(args);
			const appendEntry = (type: string, data: unknown) => pi.appendEntry(type, data);

			switch (parsed.subcommand) {
				case "now": {
					await ctx.waitForIdle();
					await runCheck(babysitter, ctx, { refs: parsed.refs, model: parsed.model, fromCounter: false, appendEntry });
					break;
				}
				case "on": {
					if (parsed.every) {
						babysitter.config.everyToolCalls = parsed.every;
						babysitter.counter.setEvery(parsed.every);
					}
					if (parsed.model) babysitter.config.model = parsed.model;
					if (parsed.refs.length > 0) babysitter.config.rules = dedupeReferences(parsed.refs, ctx.cwd);
					babysitter.state.enabled = true;
					babysitter.counter.setEnabled(true);
					notify(ctx, `babysit enabled (every ${babysitter.config.everyToolCalls} tool executions; model ${modelId(babysitter) || "unset"})`, "info");
					break;
				}
				case "off": {
					babysitter.state.enabled = false;
					babysitter.counter.setEnabled(false);
					notify(ctx, "babysit disabled.", "info");
					break;
				}
				case "status": {
					const report = statusReport(babysitter);
					if (ctx.hasUI) {
						notify(ctx, report.split("\n")[0] ?? report, "info");
						log(report);
					} else {
						console.log(report);
					}
					break;
				}
			}
		},
	});
}
