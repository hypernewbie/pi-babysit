import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeConfig, splitModelId, parsePositiveInt, DEFAULT_CONFIG } from "../src/config.ts";

test("defaults apply", () => {
	const c = mergeConfig();
	assert.equal(c.everyToolCalls, 5);
	assert.equal(c.tailTokens, 6000);
	assert.equal(c.enabled, false);
});

test("partial overrides merge", () => {
	const c = mergeConfig(DEFAULT_CONFIG, { model: "x/y", everyToolCalls: 3 });
	assert.equal(c.model, "x/y");
	assert.equal(c.everyToolCalls, 3);
	assert.equal(c.tailTokens, DEFAULT_CONFIG.tailTokens);
});

test("undefined values do not clobber", () => {
	const c = mergeConfig(DEFAULT_CONFIG, { model: undefined, everyToolCalls: 7 });
	assert.equal(c.everyToolCalls, 7);
	assert.equal(c.model, "");
});

test("splitModelId handles provider/model", () => {
	assert.deepEqual(splitModelId("anthropic/claude-3-5-haiku-latest"), {
		provider: "anthropic",
		modelId: "claude-3-5-haiku-latest",
	});
	assert.deepEqual(splitModelId("openrouter/anthropic/claude-sonnet-4"), {
		provider: "openrouter",
		modelId: "anthropic/claude-sonnet-4",
	});
});

test("splitModelId rejects malformed ids", () => {
	assert.equal(splitModelId(""), undefined);
	assert.equal(splitModelId("noprovider"), undefined);
	assert.equal(splitModelId("/model"), undefined);
	assert.equal(splitModelId("provider/"), undefined);
});

test("parsePositiveInt", () => {
	assert.equal(parsePositiveInt("10", 5), 10);
	assert.equal(parsePositiveInt(undefined, 5), 5);
	assert.equal(parsePositiveInt("abc", 5), 5);
	assert.equal(parsePositiveInt("0", 5), 5);
	assert.equal(parsePositiveInt("-2", 5), 5);
});
