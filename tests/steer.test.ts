import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSteerMessage, shouldSteer } from "../src/steer.ts";
import type { BabysitVerdict } from "../src/types.ts";

function verdict(status: "on_track" | "concern" | "off_track" | "unclear"): BabysitVerdict {
	return {
		status,
		confidence: 0.9,
		summary: "The recent activity violated the rule.",
		evidence: ["assistant talked about the roman empire", "user asked about the roman empire again"],
		recommendation: "stop",
	};
}

test("off_track message contains the reminder lines and the rule", () => {
	const msg = buildSteerMessage(verdict("off_track"), "do not talk about the roman empire");
	assert.ok(msg.includes("REMINDER: YOU ARE OFF TRACK FROM USER INTENT."));
	assert.ok(msg.includes('Auto-check rule: "do not talk about the roman empire" WAS JUDGED VIOLATED.'));
	assert.ok(msg.includes("RECONSIDER YOUR CURRENT TRAJECTORY, THINKING OR APPROACH."));
	assert.ok(msg.includes("YOU MUST REPLY TO THIS MESSAGE WITH CONCISE JUSTIFICATION, AND INTENTIONAL DECISION FORWARD."));
	assert.ok(msg.includes("assistant talked about the roman empire"));
});

test("concern message is a small reminder", () => {
	const msg = buildSteerMessage(verdict("concern"), "do not talk about the roman empire");
	assert.equal(
		msg,
		"AUTOMATIC REMINDER: Check your actions against original user prompt, did you misunderstand user intent?",
	);
});

test("no-instruction message falls back to a generic violation line", () => {
	const msg = buildSteerMessage(verdict("off_track"), undefined);
	assert.ok(msg.includes("The babysitter judged the recent session activity OFF TRACK."));
});

test("shouldSteer gates on the configured level", () => {
	assert.equal(shouldSteer("off", "off_track"), false);
	assert.equal(shouldSteer("off", "concern"), false);
	assert.equal(shouldSteer("off_track", "off_track"), true);
	assert.equal(shouldSteer("off_track", "concern"), false);
	assert.equal(shouldSteer("concern", "concern"), true);
	assert.equal(shouldSteer("concern", "off_track"), true);
	assert.equal(shouldSteer("concern", "on_track"), false);
	assert.equal(shouldSteer("concern", "unclear"), false);
});
