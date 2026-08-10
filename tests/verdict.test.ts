import { test } from "node:test";
import assert from "node:assert/strict";
import { parseVerdict, coerceVerdict, extractFencedJson, extractEmbeddedJson, repairControlChars, UNCLEAR } from "../src/verdict.ts";

const VALID = {
	status: "on_track",
	confidence: 0.87,
	summary: "Work remains focused.",
	evidence: ["tool calls modify the target package"],
	recommendation: "Continue.",
};

test("strict JSON verdict parses", () => {
	const v = parseVerdict(JSON.stringify(VALID));
	assert.equal(v.status, "on_track");
	assert.equal(v.confidence, 0.87);
	assert.equal(v.summary, "Work remains focused.");
	assert.deepEqual(v.evidence, ["tool calls modify the target package"]);
});

test("fenced JSON verdict parses", () => {
	const raw = `Here is the result:\n\`\`\`json\n${JSON.stringify(VALID)}\n\`\`\``;
	const v = parseVerdict(raw);
	assert.equal(v.status, "on_track");
});

test("bare fence without json tag parses", () => {
	const raw = "```\n" + JSON.stringify(VALID) + "\n```";
	assert.equal(parseVerdict(raw).status, "on_track");
});

test("malformed JSON becomes unclear, never off_track", () => {
	const v = parseVerdict("not json at all");
	assert.equal(v.status, "unclear");
	assert.equal(v.summary.length > 0, true);
});

test("invalid status becomes unclear", () => {
	const bad = { ...VALID, status: "maybe" };
	assert.equal(parseVerdict(JSON.stringify(bad)).status, "unclear");
});

test("confidence out of range becomes unclear", () => {
	assert.equal(parseVerdict(JSON.stringify({ ...VALID, confidence: 1.5 })).status, "unclear");
	assert.equal(parseVerdict(JSON.stringify({ ...VALID, confidence: -0.1 })).status, "unclear");
	assert.equal(parseVerdict(JSON.stringify({ ...VALID, confidence: "high" })).status, "unclear");
});

test("missing summary becomes unclear", () => {
	const { summary: _omit, ...rest } = VALID;
	assert.equal(parseVerdict(JSON.stringify(rest)).status, "unclear");
});

test("non-string evidence becomes unclear", () => {
	assert.equal(parseVerdict(JSON.stringify({ ...VALID, evidence: [42] })).status, "unclear");
});

test("missing evidence and recommendation are tolerated", () => {
	const minimal = { status: "concern", confidence: 0.5, summary: "s" };
	const v = parseVerdict(JSON.stringify(minimal));
	assert.equal(v.status, "concern");
	assert.deepEqual(v.evidence, []);
	assert.equal(v.recommendation, "");
});

test("off_track requires valid shape too", () => {
	const v = parseVerdict(JSON.stringify({ ...VALID, status: "off_track" }));
	assert.equal(v.status, "off_track");
});

test("coerceVerdict rejects non-objects", () => {
	assert.equal(coerceVerdict(null), undefined);
	assert.equal(coerceVerdict("str"), undefined);
	assert.equal(coerceVerdict([]), undefined);
});

test("extractFencedJson returns first valid object", () => {
	const raw = "a\n```json\n{\"status\":\"on_track\"}\n```\n```json\n{\"status\":\"concern\"}\n```";
	const obj = extractFencedJson(raw) as { status: string };
	assert.equal(obj.status, "on_track");
});

test("embedded JSON in prose parses", () => {
	const raw = 'Here is my assessment: {"status":"on_track","confidence":0.9,"summary":"aligned","evidence":[],"recommendation":""} Hope that helps.';
	const v = parseVerdict(raw);
	assert.equal(v.status, "on_track");
});

test("extractEmbeddedJson finds first { to last }", () => {
	const raw = 'x {"status":"on_track"} y';
	const obj = extractEmbeddedJson(raw) as { status: string };
	assert.equal(obj.status, "on_track");
});

test("control characters inside strings are repaired", () => {
	const raw = '{"status":"on_track","confidence":0.9,"summary":"line one\nline two","evidence":[],"recommendation":""}';
	const repaired = repairControlChars(raw);
	assert.ok(!/\n/.test(repaired.replace(/\\n/g, "")), "no raw newline left");
	const v = parseVerdict(raw);
	assert.equal(v.status, "on_track");
});

test("fenced JSON with control characters parses", () => {
	const raw = '```json\n{"status":"on_track","confidence":0.9,"summary":"line one\nline two","evidence":[],"recommendation":""}\n```';
	const v = parseVerdict(raw);
	assert.equal(v.status, "on_track");
});

test("missing confidence defaults to 0.5", () => {
	const v = parseVerdict(JSON.stringify({ status: "on_track", summary: "aligned", evidence: [] }));
	assert.equal(v.status, "on_track");
	assert.equal(v.confidence, 0.5);
});

test("status is case-insensitive and trimmed", () => {
	const v = parseVerdict(JSON.stringify({ status: "  On_Track ", confidence: 0.8, summary: "ok" }));
	assert.equal(v.status, "on_track");
});

test("unclear includes a raw snippet", () => {
	const v = parseVerdict("sorry, no json here");
	assert.equal(v.status, "unclear");
	assert.ok(v.summary.includes("sorry, no json here"));
});

test("UNCLEAR constant is stable", () => {
	assert.equal(UNCLEAR.status, "unclear");
	assert.deepEqual(UNCLEAR.evidence, []);
});
