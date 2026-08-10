/**
 * Model lookup and invocation for a babysitter check.
 *
 * Uses `ctx.modelRegistry` (the extension-visible runtime) to find and call a
 * separately configured model. The babysitter request has no tools, a small
 * output cap, deterministic sampling, and an abort signal. It never touches
 * the main session's model.
 *
 * The `ModelRegistryCtx` interface is structural so the module is testable
 * without the Pi runtime.
 */

import type { BabysitVerdict } from "./types.ts";
import { splitModelId } from "./config.ts";
import { parseVerdict } from "./verdict.ts";

export interface CheckOptions {
	/** "provider/model-id" */
	modelId: string;
	systemPrompt: string;
	activityPrompt: string;
	signal?: AbortSignal;
	sessionId: string;
	/** Provider cache retention hint. Defaults to "short". */
	cacheRetention?: "none" | "short" | "long";
	maxTokens?: number;
}

export interface ModelCallResult {
	ok: boolean;
	verdict?: BabysitVerdict;
	error?: string;
	usage: { input: number; output: number; cacheRead: number; cacheWrite: number; cost: number };
}

export interface ModelRegistryCtx {
	modelRegistry: {
		find(provider: string, modelId: string): unknown;
		hasConfiguredAuth?(model: unknown): boolean;
		complete(
			model: unknown,
			context: {
				systemPrompt?: string;
				messages: Array<{
					role: "user";
					content: Array<{ type: "text"; text: string }>;
					timestamp: number;
				}>;
			},
			options: Record<string, unknown>,
		): Promise<{
			content: Array<{ type: string; text?: string }>;
			usage: { input: number; output: number; cacheRead: number; cacheWrite: number; cost: { total: number } };
			stopReason?: string;
			errorMessage?: string;
		}>;
	};
}

const DEFAULT_MAX_TOKENS = 300;

/** Find the configured model; returns { ok: false, error } on any problem. */
export function resolveModel(ctx: ModelRegistryCtx, modelId: string): { ok: true; model: unknown } | { ok: false; error: string } {
	const parts = splitModelId(modelId);
	if (!parts) return { ok: false, error: `invalid babysitter model id "${modelId}" (expected provider/model-id)` };
	const model = ctx.modelRegistry.find(parts.provider, parts.modelId);
	if (!model) {
		return { ok: false, error: `model ${modelId} not found in the configured model catalogue` };
	}
	if (ctx.modelRegistry.hasConfiguredAuth && !ctx.modelRegistry.hasConfiguredAuth(model)) {
		return { ok: false, error: `no authentication configured for ${modelId}` };
	}
	return { ok: true, model };
}

/**
 * Run one babysitter model call. Never throws for request/runtime failures:
 * they come back as `{ ok: false, error }` and are NOT parsed as verdicts.
 */
export async function runModelCheck(ctx: ModelRegistryCtx, opts: CheckOptions): Promise<ModelCallResult> {
	const resolved = resolveModel(ctx, opts.modelId);
	if (!resolved.ok) return { ok: false, error: resolved.error, usage: emptyUsage() };

	const empty = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };

	let response;
	try {
		response = await ctx.modelRegistry.complete(
			resolved.model,
			{
				systemPrompt: opts.systemPrompt,
				messages: [
					{
						role: "user",
						content: [{ type: "text", text: opts.activityPrompt }],
						timestamp: Date.now(),
					},
				],
			},
			{
				maxTokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
				temperature: 0,
				sessionId: opts.sessionId,
				cacheRetention: opts.cacheRetention ?? "short",
				...(opts.signal ? { signal: opts.signal } : {}),
			},
		);
	} catch (err) {
		return { ok: false, error: err instanceof Error ? err.message : String(err), usage: empty };
	}

	const usage = {
		input: response.usage?.input ?? 0,
		output: response.usage?.output ?? 0,
		cacheRead: response.usage?.cacheRead ?? 0,
		cacheWrite: response.usage?.cacheWrite ?? 0,
		cost: response.usage?.cost?.total ?? 0,
	};

	if (response.stopReason === "error" || response.stopReason === "aborted") {
		return {
			ok: false,
			error: response.errorMessage ?? `model request ${response.stopReason}`,
			usage,
		};
	}

	const text = (response.content ?? [])
		.filter((c): c is { type: string; text: string } => c.type === "text" && typeof c.text === "string")
		.map((c) => c.text)
		.join("\n");

	return { ok: true, verdict: parseVerdict(text), usage };
}

function emptyUsage() {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
}
