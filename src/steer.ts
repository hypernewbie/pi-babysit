/**
 * Steering messages: injected into the main session when the babysitter
 * judges a rule violation.
 *
 * Advisory by default (`steer: "off"`). When enabled, an off_track (or
 * concern) verdict is turned into a custom_message the main agent sees as a
 * user message, delivered with `triggerTurn` so the agent must reply.
 */

import type { BabysitVerdict } from "./types.ts";

export type SteerLevel = "off" | "concern" | "off_track";

/** Custom entry type for steering messages (persisted in the session). */
export const STEER_CUSTOM_TYPE = "babysit.steer";

/** Minimum delay between steering injections, to avoid spamming turns. */
export const STEER_COOLDOWN_MS = 30_000;

/** Build the steering block injected into the main session. */
export function buildSteerMessage(verdict: BabysitVerdict, instruction: string | undefined): string {
	if (verdict.status === "concern") {
		// Soft nudge for possible drift: small, no evidence dump.
		return "AUTOMATIC REMINDER: Check your actions against original user prompt, did you misunderstand user intent?";
	}
	const offTrack = verdict.status === "off_track";
	const headline = offTrack
		? "REMINDER: YOU ARE OFF TRACK FROM USER INTENT."
		: "REMINDER: YOU MAY BE OFF TRACK FROM USER INTENT.";
	const ruleLine = instruction
		? `Auto-check rule: "${instruction}" WAS JUDGED ${offTrack ? "VIOLATED" : "POSSIBLY VIOLATED"}.`
		: `The babysitter judged the recent session activity ${offTrack ? "OFF TRACK" : "CONCERNING"}.`;
	const evidence =
		verdict.evidence.length > 0
			? verdict.evidence
					.slice(0, 2)
					.map((e) => `- ${e}`)
					.join("\n")
			: `- ${verdict.summary}`;
	return [
		`👶 babysit ${headline}`,
		"",
		ruleLine,
		"",
		"Evidence:",
		evidence,
		"",
		"RECONSIDER YOUR CURRENT TRAJECTORY, THINKING OR APPROACH.",
		"",
		"YOU MUST REPLY TO THIS MESSAGE WITH CONCISE JUSTIFICATION, AND INTENTIONAL DECISION FORWARD.",
	].join("\n");
}

/** Whether a verdict should trigger steering for the configured level. */
export function shouldSteer(level: SteerLevel, status: string): boolean {
	if (level === "off") return false;
	if (status === "on_track" || status === "unclear") return false;
	if (level === "off_track") return status === "off_track";
	return status === "concern" || status === "off_track";
}
