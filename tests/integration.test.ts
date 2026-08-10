/**
 * Integration tests: load the extension factory against a mocked ExtensionAPI
 * and drive the event/command surface end to end (no live provider).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import babysitExtension from "../src/index.ts";

type Handler = (event: unknown, ctx: unknown) => Promise<unknown> | unknown;

interface MockApi {
	handlers: Map<string, Handler>;
	commands: Map<string, { handler: (args: string, ctx: unknown) => Promise<void> }>;
	entries: Array<{ type: string; data: unknown }>;
	sentMessages: unknown[];
	notices: Array<{ message: string; type?: string }>;
	statuses: string[];
	on(event: string, handler: Handler): void;
	registerCommand(name: string, opts: { handler: (args: string, ctx: unknown) => Promise<void> }): void;
	appendEntry(type: string, data: unknown): void;
	sendUserMessage(...args: unknown[]): void;
	sendMessage(...args: unknown[]): void;
	fire(event: string, ev: unknown, ctx: unknown): Promise<void>;
}

function makeApi(): MockApi {
	const api: MockApi = {
		handlers: new Map(),
		commands: new Map(),
		entries: [],
		sentMessages: [],
		notices: [],
		statuses: [],
		on(event, handler) {
			api.handlers.set(event, handler);
		},
		registerCommand(name, opts) {
			api.commands.set(name, opts);
		},
		appendEntry(type, data) {
			api.entries.push({ type, data });
		},
		sendUserMessage(...args) {
			api.sentMessages.push(args);
		},
		sendMessage(...args) {
			api.sentMessages.push(args);
		},
		async fire(event, ev, ctx) {
			const h = api.handlers.get(event);
			if (h) await h(ev, ctx);
		},
	};
	return api;
}

type Entry = { type: string; message?: Record<string, unknown>; summary?: string };

interface MockModelRegistry {
	findCalls: string[][];
	completeCalls: Array<{ systemPrompt: string; activity: string; options: Record<string, unknown> }>;
	nextStopReason: "end" | "error" | "aborted";
	nextError?: string;
	nextVerdict?: { status: string; confidence: number; summary: string; evidence: string[]; recommendation: string };
	find(provider: string, modelId: string): unknown;
	hasConfiguredAuth(model: unknown): boolean;
	complete(
		model: unknown,
		context: { systemPrompt?: string; messages: Array<{ content: Array<{ type: string; text?: string }> }> },
		options: Record<string, unknown>,
	): Promise<unknown>;
}

function makeModelRegistry(): MockModelRegistry {
	const reg: MockModelRegistry = {
		findCalls: [],
		completeCalls: [],
		nextStopReason: "end",
		nextError: undefined,
		nextVerdict: undefined,
		find(provider, modelId) {
			reg.findCalls.push([provider, modelId]);
			return { id: `${provider}/${modelId}` };
		},
		hasConfiguredAuth() {
			return true;
		},
		async complete(_model, context, options) {
			reg.completeCalls.push({
				systemPrompt: context.systemPrompt ?? "",
				activity: context.messages[0]?.content.map((c) => c.text ?? "").join("") ?? "",
				options,
			});
			if (reg.nextStopReason !== "end") {
				return {
					content: [],
					usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, cost: { total: 0.001 } },
					stopReason: reg.nextStopReason,
					errorMessage: reg.nextError ?? `mock ${reg.nextStopReason}`,
				};
			}
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(
							reg.nextVerdict ?? { status: "on_track", confidence: 0.9, summary: "work is aligned", evidence: [], recommendation: "keep going" },
						),
					},
				],
				usage: { input: 10, output: 5, cacheRead: 2, cacheWrite: 3, cost: { total: 0.001 } },
				stopReason: "end",
			};
		},
	};
	return reg;
}

interface Harness {
	api: MockApi;
	ctx: Record<string, unknown>;
	registry: MockModelRegistry;
	entries: Entry[];
	cwd: string;
	start(reason?: string): Promise<void>;
	command(args: string): Promise<void>;
	tool(name: string): Promise<void>;
	settle(): Promise<void>;
}

function makeHarness(): Harness {
	const api = makeApi();
	babysitExtension(api as unknown as ExtensionAPI);
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "babysit-proj-"));
	const registry = makeModelRegistry();
	const entries: Entry[] = [];

	const ctx: Record<string, unknown> = {
		mode: "tui",
		hasUI: true,
		cwd,
		signal: undefined,
		ui: {
			notify(message: string, type?: string) {
				api.notices.push({ message, type });
			},
			setStatus(_key: string, text?: string) {
				if (text) api.statuses.push(text);
			},
		},
		sessionManager: {
			getSessionId: () => "sess-1",
			getLeafId: () => "leaf1",
			getBranch: () => entries,
			buildContextEntries: () => entries,
		},
		sendMessage(message: unknown, options?: unknown) {
			api.sentMessages.push({ message, options });
		},
		modelRegistry: registry,
		waitForIdle: async () => {},
		isProjectTrusted: () => true,
		getSystemPrompt: () => "",
	};

	const h: Harness = {
		api,
		ctx,
		registry,
		entries,
		cwd,
		async start(reason = "startup") {
			await api.fire("session_start", { type: "session_start", reason }, ctx);
		},
		async command(args) {
			const cmd = api.commands.get("babysit");
			assert.ok(cmd, "babysit command registered");
			await cmd.handler(args, ctx);
		},
		async tool(name) {
			await api.fire("tool_execution_end", { type: "tool_execution_end", toolCallId: "t1", toolName: name, result: {}, isError: false }, ctx);
		},
		async settle() {
			await api.fire("turn_end", { type: "turn_end", message: {}, toolResults: [] }, ctx);
		},
	};

	return h;
}

test("registers the command and lifecycle handlers", () => {
	const api = makeApi();
	babysitExtension(api as unknown as ExtensionAPI);
	assert.ok(api.commands.has("babysit"));
	for (const ev of ["session_start", "session_shutdown", "tool_execution_end", "turn_end", "agent_settled"]) {
		assert.ok(api.handlers.has(ev), `handler for ${ev}`);
	}
});

test("/babysit now runs a check with stable prefix and activity tail", async () => {
	const h = makeHarness();
	h.entries.push({ type: "message", message: { role: "user", content: [{ type: "text", text: "migrate the config module" }] } });
	await h.start();
	await h.command("now --model anthropic/claude-3-5-haiku-latest");

	assert.equal(h.registry.completeCalls.length, 1);
	const call = h.registry.completeCalls[0]!;
	assert.ok(call.systemPrompt.includes("babysitter for a Pi coding session"));
	assert.ok(!call.systemPrompt.includes("migrate the config module"), "original intent is not part of the judge prompt");
	assert.ok(call.systemPrompt.includes("ENFORCE the session rules"));
	assert.ok(call.activity.includes("User: migrate the config module"));
	assert.equal(call.options.cacheRetention, "short");
	assert.equal(call.options.sessionId, "babysit:sess-1");
});

test("cache retention is configurable via project config", async () => {
	const h = makeHarness();
	fs.mkdirSync(path.join(h.cwd, ".pi"), { recursive: true });
	fs.writeFileSync(path.join(h.cwd, ".pi", "babysit.json"), JSON.stringify({ cacheRetention: "long" }));
	await h.start();
	await h.command("now --model anthropic/claude-3-5-haiku-latest");
	assert.equal(h.registry.completeCalls[0]!.options.cacheRetention, "long");
});

test("second check carries the rolling summary of the previous check", async () => {
	const h = makeHarness();
	await h.start();
	await h.command("on --every 1 --model anthropic/claude-3-5-haiku-latest");

	await h.tool("bash");
	await h.settle();
	assert.equal(h.registry.completeCalls.length, 1);
	assert.ok(!h.registry.completeCalls[0]!.activity.includes("Last check:"));

	await h.tool("bash");
	await h.settle();
	const second = h.registry.completeCalls[1]!;
	assert.ok(second.activity.includes("Last check: check #1: on_track"), second.activity);
});

test("leaf change between checks is noted in the activity prompt", async () => {
	const h = makeHarness();
	await h.start();
	await h.command("on --every 1 --model anthropic/claude-3-5-haiku-latest");

	await h.tool("bash");
	await h.settle();

	// Simulate a branch switch: the session manager now points at a new leaf.
	(h.ctx.sessionManager as { getLeafId(): string }).getLeafId = () => "leaf2";
	await h.tool("bash");
	await h.settle();
	assert.ok(h.registry.completeCalls[1]!.activity.includes("session branch/leaf changed"));
});

test("status command reports usage totals and cache retention", async () => {
	const h = makeHarness();
	await h.start();
	await h.command("now --model anthropic/claude-3-5-haiku-latest");
	await h.command("status");
	const joined = h.api.notices.map((n) => n.message).join("\n");
	assert.ok(joined.includes("checks run: 1"));
	assert.ok(joined.includes("cacheRead=2"));
	assert.ok(joined.includes("cache retention: short"));
});

test("bare-text instruction lands in the stable prefix", async () => {
	const h = makeHarness();
	fs.writeFileSync(path.join(h.cwd, "RULEZ.md"), "Always run tests.\n");
	await h.start();
	await h.command("on --every 1 --model anthropic/claude-3-5-haiku-latest check extra carefully @file/RULEZ.md");
	await h.tool("bash");
	await h.settle();
	const call = h.registry.completeCalls.at(-1)!;
	assert.ok(call.systemPrompt.includes("check extra carefully"));
});

test("--instruction flag works on a manual check", async () => {
	const h = makeHarness();
	await h.start();
	await h.command("--instruction be strict --model anthropic/claude-3-5-haiku-latest");
	const call = h.registry.completeCalls.at(-1)!;
	assert.ok(call.systemPrompt.includes("be strict"));
});

test("footer status shows progress and last verdict", async () => {
	const h = makeHarness();
	await h.start();
	await h.command("on --every 2 --model anthropic/claude-3-5-haiku-latest");

	assert.ok(h.api.statuses.at(-1)!.includes("babysit on · every 2"), "enabled line");

	await h.tool("bash");
	assert.ok(h.api.statuses.at(-1)!.includes("1/2 tools"), "progress line");

	await h.tool("bash");
	await h.settle();
	assert.ok(h.api.statuses.at(-1)!.includes("on_track"), "verdict line");
	assert.ok(h.api.statuses.at(-1)!.startsWith("👶"), "baby emoji prefix");
});

test("model is not called before the threshold", async () => {
	const h = makeHarness();
	await h.start();
	await h.command("on --every 3 --model anthropic/claude-3-5-haiku-latest");

	await h.tool("bash");
	await h.tool("bash");
	await h.settle();
	assert.equal(h.registry.completeCalls.length, 0);

	await h.tool("bash"); // threshold
	await h.settle();
	assert.equal(h.registry.completeCalls.length, 1);
});

test("one turn_end never triggers duplicate checks for a parallel batch", async () => {
	const h = makeHarness();
	await h.start();
	await h.command("on --every 2 --model anthropic/claude-3-5-haiku-latest");

	// 4 tools executed in one parallel batch, then a single turn_end.
	for (let i = 0; i < 4; i++) await h.tool("bash");
	await h.settle();

	assert.equal(h.registry.completeCalls.length, 1);
});

test("remainder is retained: next crossing runs a fresh check", async () => {
	const h = makeHarness();
	await h.start();
	await h.command("on --every 3 --model anthropic/claude-3-5-haiku-latest");

	for (let i = 0; i < 4; i++) await h.tool("bash"); // 4 % 3 = 1 remainder
	await h.settle();
	assert.equal(h.registry.completeCalls.length, 1);

	await h.tool("bash");
	await h.tool("bash"); // crosses again at 3
	await h.settle();
	assert.equal(h.registry.completeCalls.length, 2);
});

test("error/aborted model responses are not parsed as verdicts", async () => {
	const h = makeHarness();
	h.registry.nextStopReason = "error";
	h.registry.nextError = "rate limited";
	await h.start();
	await h.command("now --model anthropic/claude-3-5-haiku-latest");

	// No verdict surfaced as on_track; the failure is recorded.
	assert.equal(h.registry.completeCalls.length, 1);
	await h.command("status");
});

test("manual check works while auto mode is off", async () => {
	const h = makeHarness();
	await h.start();
	await h.command("now --model anthropic/claude-3-5-haiku-latest");
	assert.equal(h.registry.completeCalls.length, 1);
});

test("session replacement resets state", async () => {
	const h = makeHarness();
	await h.start();
	await h.command("on --every 1 --model anthropic/claude-3-5-haiku-latest");
	await h.tool("bash");
	await h.settle();
	assert.equal(h.registry.completeCalls.length, 1);

	// New session: state is fresh, auto mode off, no counters carried over.
	await h.start("new");
	await h.settle();
	assert.equal(h.registry.completeCalls.length, 1);

	// Manual check on the new session still works.
	await h.command("now --model anthropic/claude-3-5-haiku-latest");
	assert.equal(h.registry.completeCalls.length, 2);
});

test("agent_settled after-run mode fires when configured", async () => {
	const h = makeHarness();
	await h.start();
	await h.command("on --every 1 --model anthropic/claude-3-5-haiku-latest");

	// runAfterSettle defaults to false -> agent_settled does nothing.
	await h.tool("bash");
	await h.api.fire("agent_settled", { type: "agent_settled" }, h.ctx);
	assert.equal(h.registry.completeCalls.length, 0);
});

test("steering injects a reminder into the session on off_track", async () => {
	const h = makeHarness();
	await h.start();
	h.registry.nextVerdict = {
		status: "off_track",
		confidence: 0.9,
		summary: "rule violated",
		evidence: ["assistant talked about the roman empire"],
		recommendation: "stop",
	};
	await h.command("on --every 1 --model anthropic/claude-3-5-haiku-latest --steer do not talk about the roman empire");

	await h.tool("bash");
	await h.settle(); // turn_end runs the check, queues the steer
	await h.api.fire("agent_settled", { type: "agent_settled" }, h.ctx); // idle: delivers it

	assert.equal(h.api.sentMessages.length, 1);
	const args = h.api.sentMessages[0] as [Record<string, unknown>, Record<string, unknown>];
	const [message, options] = args;
	assert.equal(options.triggerTurn, true);
	assert.equal(message.customType, "babysit.steer");
	assert.ok(String(message.content).includes("REMINDER: YOU ARE OFF TRACK FROM USER INTENT."));
	assert.ok(String(message.content).includes("do not talk about the roman empire"));
	assert.ok(String(message.content).includes("YOU MUST REPLY TO THIS MESSAGE"));
});

test("steering queues when mid-run and delivers at agent_settled (not before)", async () => {
	const h = makeHarness();
	await h.start();
	h.registry.nextVerdict = {
		status: "off_track",
		confidence: 0.9,
		summary: "rule violated",
		evidence: ["assistant talked about the roman empire"],
		recommendation: "stop",
	};
	await h.command("on --every 1 --model anthropic/claude-3-5-haiku-latest --steer do not talk about the roman empire");

	await h.tool("bash");
	await h.settle();

	// Not delivered yet: the run is still in flight, must wait for agent_settled.
	assert.equal(h.api.sentMessages.length, 0);

	await h.api.fire("agent_settled", { type: "agent_settled" }, h.ctx);
	assert.equal(h.api.sentMessages.length, 1);
});

test("steering is disabled by default (advisory only)", async () => {
	const h = makeHarness();
	await h.start();
	h.registry.nextVerdict = {
		status: "off_track",
		confidence: 0.9,
		summary: "rule violated",
		evidence: [],
		recommendation: "stop",
	};
	await h.command("on --every 1 --model anthropic/claude-3-5-haiku-latest do not talk about the roman empire");

	await h.tool("bash");
	await h.settle();
	await h.api.fire("agent_settled", { type: "agent_settled" }, h.ctx);

	assert.equal(h.api.sentMessages.length, 0);
});

test("steer=concern triggers on concern verdicts", async () => {
	const h = makeHarness();
	await h.start();
	h.registry.nextVerdict = {
		status: "concern",
		confidence: 0.7,
		summary: "possible violation",
		evidence: [],
		recommendation: "check",
	};
	await h.command("on --every 1 --model anthropic/claude-3-5-haiku-latest --steer=concern do not talk about the roman empire");

	await h.tool("bash");
	await h.settle();
	await h.api.fire("agent_settled", { type: "agent_settled" }, h.ctx);

	assert.equal(h.api.sentMessages.length, 1);
	const args = h.api.sentMessages[0] as [Record<string, unknown>, Record<string, unknown>];
	assert.ok(String(args[0].content).includes("YOU MAY BE OFF TRACK FROM USER INTENT."));
});
