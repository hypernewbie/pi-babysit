import { test } from "node:test";
import assert from "node:assert/strict";
import { ToolCounter } from "../src/scheduler.ts";

test("counts up to threshold and becomes pending", () => {
	const c = new ToolCounter(3);
	for (let i = 0; i < 2; i++) c.countTool();
	assert.equal(c.pending, false);
	c.countTool();
	assert.equal(c.pending, true);
	assert.equal(c.count, 3);
});

test("beginCheck claims once; second claim blocked while in flight", () => {
	const c = new ToolCounter(2);
	c.countTool();
	c.countTool();
	assert.equal(c.beginCheck(), true);
	assert.equal(c.beginCheck(), false);
	c.finishCheck();
	assert.equal(c.beginCheck(), false); // remainder 0, not pending
});

test("finishCheck retains remainder after crossing multiple times", () => {
	const c = new ToolCounter(3);
	// parallel batch: 7 tools in one turn
	for (let i = 0; i < 7; i++) c.countTool();
	assert.equal(c.beginCheck(), true);
	c.finishCheck();
	// 7 % 3 = 1; 1 >= 3 is false -> not pending
	assert.equal(c.pending, false);
	assert.equal(c.count, 1);
});

test("remainder can re-trigger a pending check", () => {
	const c = new ToolCounter(3);
	for (let i = 0; i < 8; i++) c.countTool(); // 8 tools
	assert.equal(c.beginCheck(), true);
	c.finishCheck();
	// 8 % 3 = 2, 2 < 3 -> not pending
	assert.equal(c.pending, false);
	// another tool crosses again
	c.countTool();
	assert.equal(c.pending, true);
});

test("disabled counter does not count", () => {
	const c = new ToolCounter(2);
	c.setEnabled(false);
	c.countTool();
	c.countTool();
	assert.equal(c.count, 0);
	assert.equal(c.pending, false);
});

test("setEvery resets counts", () => {
	const c = new ToolCounter(2);
	c.countTool();
	c.countTool();
	assert.equal(c.pending, true);
	c.setEvery(5);
	assert.equal(c.count, 0);
	assert.equal(c.pending, false);
});

test("reset clears everything including in-flight", () => {
	const c = new ToolCounter(1);
	c.countTool();
	assert.equal(c.beginCheck(), true);
	c.reset();
	assert.equal(c.inFlight, false);
	assert.equal(c.pending, false);
	assert.equal(c.beginCheck(), false);
});

test("releaseInFlight allows future checks without touching counts", () => {
	const c = new ToolCounter(2);
	c.countTool();
	c.countTool();
	assert.equal(c.beginCheck(), true);
	c.releaseInFlight();
	assert.equal(c.inFlight, false);
	assert.equal(c.pending, true);
});
