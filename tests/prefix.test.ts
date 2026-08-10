import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStablePrefix, hashStablePrefix, type PrefixInputs } from "../src/prefix.ts";

function inputs(overrides: Partial<PrefixInputs> = {}): PrefixInputs {
	return {
		modelId: "anthropic/claude-3-5-haiku-latest",
		intent: "Migrate the config module.",
		references: [
			{
				absPath: "/proj/RULEZ.md",
				displayPath: "RULEZ.md",
				content: "Always run tests.",
				hash: "h1",
				size: 17,
			},
		],
		everyToolCalls: 5,
		tailTokens: 6000,
		...overrides,
	};
}

test("prefix is deterministic for identical inputs", () => {
	assert.equal(buildStablePrefix(inputs()), buildStablePrefix(inputs()));
});

test("prefix includes intent and reference contents", () => {
	const p = buildStablePrefix(inputs());
	assert.ok(p.includes("Migrate the config module."));
	assert.ok(p.includes("<reference_file path=\"RULEZ.md\">"));
	assert.ok(p.includes("Always run tests."));
	assert.ok(p.includes("</reference_file>"));
});

test("prefix contains no timestamps or counters", () => {
	const p = buildStablePrefix(inputs());
	assert.ok(!/\d{4}-\d{2}-\d{2}/.test(p));
	assert.ok(!/check #/.test(p));
});

test("changing a reference changes the prefix and its hash", () => {
	const a = inputs();
	const b = inputs();
	b.references[0]!.content = "Always run tests AND lint.";
	assert.notEqual(buildStablePrefix(a), buildStablePrefix(b));
	assert.notEqual(hashStablePrefix(a), hashStablePrefix(b));
});

test("reference order is deterministic (sorted by input order)", () => {
	const a = inputs({ references: [ref("b.md", "B"), ref("a.md", "A")] });
	const b = inputs({ references: [ref("b.md", "B"), ref("a.md", "A")] });
	assert.equal(buildStablePrefix(a), buildStablePrefix(b));
	assert.ok(buildStablePrefix(a).indexOf("b.md") < buildStablePrefix(a).indexOf("a.md"));
});

function ref(displayPath: string, content: string) {
	return { absPath: "/proj/" + displayPath, displayPath, content, hash: content, size: content.length };
}

test("empty intent produces a placeholder", () => {
	const p = buildStablePrefix(inputs({ intent: "" }));
	assert.ok(p.includes("(no user intent captured yet)"));
});

test("output schema is present", () => {
	const p = buildStablePrefix(inputs());
	assert.ok(p.includes("\"status\""));
	assert.ok(p.includes("confidence"));
});
