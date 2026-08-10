import { test } from "node:test";
import assert from "node:assert/strict";
import { buildActivityTail, normalizeEntries, type ActivityEntry } from "../src/activity.ts";

function user(text: string): ActivityEntry {
	return { type: "message", message: { role: "user", content: [{ type: "text", text }] } };
}

function assistant(text: string, toolCalls: Array<{ name: string; args: unknown }> = []): ActivityEntry {
	const content: unknown[] = text ? [{ type: "text", text }] : [];
	for (const tc of toolCalls) content.push({ type: "toolCall", name: tc.name, arguments: tc.args });
	return { type: "message", message: { role: "assistant", content } };
}

function toolResult(toolName: string, text: string, isError = false): ActivityEntry {
	return {
		type: "message",
		message: { role: "toolResult", toolName, content: [{ type: "text", text }], isError },
	};
}

function compaction(summary: string): ActivityEntry {
	return { type: "compaction", summary };
}

function branchSummary(summary: string): ActivityEntry {
	return { type: "branch_summary", summary };
}

function opts(overrides: Partial<{ maxChars: number; maxToolResultChars: number; maxToolResults: number }> = {}) {
	return { maxChars: 100000, maxToolResultChars: 40, maxToolResults: 3, ...overrides };
}

test("normalizes user/assistant/tool messages in order", () => {
	const entries = [user("fix the bug"), assistant("looking", [{ name: "bash", args: { command: "make test" } }]), toolResult("bash", "ok", true)];
	const { events } = normalizeEntries(entries, opts());
	assert.deepEqual(
		events.map((e) => e.text),
		["User: fix the bug", "Assistant: looking\n→ bash({\"command\":\"make test\"})", "Tool bash (ERROR): ok"],
	);
});

test("thinking blocks are stripped", () => {
	const entry: ActivityEntry = {
		type: "message",
		message: { role: "assistant", content: [{ type: "thinking", text: "secret reasoning" }, { type: "text", text: "visible" }] },
	};
	const { events } = normalizeEntries([entry], opts());
	assert.deepEqual(events.map((e) => e.text), ["Assistant: visible"]);
});

test("tool result text is truncated to budget", () => {
	const r = buildActivityTail([toolResult("read", "x".repeat(200))], opts({ maxToolResultChars: 40 }));
	assert.ok(r.text.includes("x".repeat(40) + "…"));
	assert.equal(r.truncated, true);
});

test("custom and label entries are ignored", () => {
	const entries = [user("hi"), { type: "custom", customType: "babysit-check" } as unknown as ActivityEntry];
	const { events } = normalizeEntries(entries, opts());
	assert.equal(events.length, 1);
});

test("compaction and branch summaries surface", () => {
	const entries = [compaction("we compacted things"), branchSummary("abandoned attempt")];
	const { events } = normalizeEntries(entries, opts());
	assert.ok(events[0]!.text.startsWith("[context compacted]"));
	assert.ok(events[1]!.text.startsWith("[abandoned branch]"));
});

test("budget drops oldest non-user entries but keeps newest user message", () => {
	const entries = [user("old goal"), assistant("work1"), assistant("work2"), user("latest instruction")];
	const r = buildActivityTail(entries, opts({ maxChars: 30 }));
	assert.ok(r.text.includes("latest instruction"));
	assert.ok(r.text.includes("old goal"), "user messages always survive");
	assert.equal(r.dropped >= 1, true);
});

test("empty input produces placeholder", () => {
	const r = buildActivityTail([], opts());
	assert.equal(r.text, "(no recent activity)");
});

test("tool result cap per run", () => {
	const entries = [toolResult("bash", "a"), toolResult("bash", "b"), toolResult("bash", "c"), toolResult("bash", "d")];
	const { events } = normalizeEntries(entries, opts({ maxToolResults: 2 }));
	assert.equal(events.length, 2);
});

test("output is chronological", () => {
	const entries = [user("first"), user("second")];
	const r = buildActivityTail(entries, opts());
	assert.ok(r.text.indexOf("first") < r.text.indexOf("second"));
});
