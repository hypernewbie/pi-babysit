import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCommand } from "../src/command.ts";

test("empty args defaults to now", () => {
	const c = parseCommand("");
	assert.equal(c.subcommand, "now");
	assert.deepEqual(c.refs, []);
});

test("bare subcommand parses", () => {
	assert.equal(parseCommand("now").subcommand, "now");
	assert.equal(parseCommand("on").subcommand, "on");
	assert.equal(parseCommand("off").subcommand, "off");
	assert.equal(parseCommand("status").subcommand, "status");
});

test("now with @file references", () => {
	const c = parseCommand("now @file/RULEZ.md @file/docs/constraints.md");
	assert.equal(c.subcommand, "now");
	assert.deepEqual(c.refs, ["RULEZ.md", "docs/constraints.md"]);
});

test("absolute @file references are preserved", () => {
	const c = parseCommand("now @file//tmp/emergency-rules.md");
	assert.deepEqual(c.refs, ["/tmp/emergency-rules.md"]);
});

test("on with every and model flags", () => {
	const c = parseCommand("on --every 5 --model anthropic/claude-3-5-haiku-latest");
	assert.equal(c.subcommand, "on");
	assert.equal(c.every, 5);
	assert.equal(c.model, "anthropic/claude-3-5-haiku-latest");
});

test("tail-tokens flag", () => {
	const c = parseCommand("now --tail-tokens 6000");
	assert.equal(c.tailTokens, 6000);
});

test("invalid numbers fall back to undefined", () => {
	const c = parseCommand("on --every nope --tail-tokens -3");
	assert.equal(c.every, undefined);
	assert.equal(c.tailTokens, undefined);
});

test("model id with slashes", () => {
	const c = parseCommand("now --model openrouter/anthropic/claude-sonnet-4");
	assert.equal(c.model, "openrouter/anthropic/claude-sonnet-4");
});
