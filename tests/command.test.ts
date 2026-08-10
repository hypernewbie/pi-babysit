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

test("bare --steer defaults to off_track", () => {
	const c = parseCommand("on --every 5 --model x/y --steer");
	assert.equal(c.steer, "off_track");
});

test("--steer=level parses each level", () => {
	assert.equal(parseCommand("on --steer=off").steer, "off");
	assert.equal(parseCommand("on --steer=concern").steer, "concern");
	assert.equal(parseCommand("on --steer=off_track").steer, "off_track");
});

test("--steer with explicit level token", () => {
	assert.equal(parseCommand("on --steer concern").steer, "concern");
});

test("--steer does not swallow the instruction", () => {
	const c = parseCommand("on --steer --every 2 do not talk about the roman empire");
	assert.equal(c.steer, "off_track");
	assert.equal(c.every, 2);
	assert.equal(c.instruction, "do not talk about the roman empire");
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

test("bare text after flags becomes the instruction", () => {
	const c = parseCommand("on --every 5 --model x/y here dont follow these rules pls: @file/RULEZ.md");
	assert.equal(c.subcommand, "on");
	assert.equal(c.every, 5);
	assert.equal(c.model, "x/y");
	assert.deepEqual(c.refs, ["RULEZ.md"]);
	assert.equal(c.instruction, "here dont follow these rules pls:");
});

test("--instruction collects tokens until a flag or reference", () => {
	const c = parseCommand("now --instruction check carefully --model x/y @file/RULEZ.md");
	assert.equal(c.instruction, "check carefully");
	assert.equal(c.model, "x/y");
	assert.deepEqual(c.refs, ["RULEZ.md"]);
});

test("no leftover text means no instruction", () => {
	assert.equal(parseCommand("now --model x/y").instruction, undefined);
	assert.equal(parseCommand("@file/RULEZ.md").instruction, undefined);
});
