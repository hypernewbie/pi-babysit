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

function opts(overrides: Partial<{ maxChars: number }> = {}) {
	return { maxChars: 100000, ...overrides };
}

test("tool calls and tool results are excluded from the eval", () => {
	const entries = [
		user("fix the bug"),
		assistant("looking", [{ name: "bash", args: { command: "make test" } }]),
		toolResult("bash", "ok", true),
	];
	const { events } = normalizeEntries(entries, opts());
	assert.deepEqual(
		events.map((e) => e.text),
		["User: fix the bug", "Assistant: looking"],
	);
});

test("conversation-only tail has no tool content", () => {
	const entries = [
		user("fix the bug"),
		assistant("looking", [{ name: "bash", args: { command: "make test" } }]),
		toolResult("read", "x".repeat(200)),
		toolResult("read", "y".repeat(200)),
	];
	const r = buildActivityTail(entries, opts());
	assert.ok(r.text.includes("fix the bug"));
	assert.ok(r.text.includes("looking"));
	assert.ok(!r.text.includes("→ bash"));
	assert.ok(!r.text.includes("Tool "));
	assert.equal(r.truncated, false);
});

test("thinking blocks are stripped", () => {
	const entry: ActivityEntry = {
		type: "message",
		message: { role: "assistant", content: [{ type: "thinking", text: "secret reasoning" }, { type: "text", text: "visible" }] },
	};
	const { events } = normalizeEntries([entry], opts());
	assert.deepEqual(events.map((e) => e.text), ["Assistant: visible"]);
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
