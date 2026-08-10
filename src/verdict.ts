/**
 * Strict verdict parsing for the babysitter model response.
 *
 * Contract (from the plan):
 * 1. Parse strict JSON first.
 * 2. Optionally extract a single JSON object from a fenced code block.
 * 3. Validate enum values, confidence range, and string/array fields.
 * 4. Treat malformed output as `unclear`, never as `off_track`.
 */

import type { BabysitVerdict, VerdictStatus } from "./types.ts";

const STATUSES: readonly VerdictStatus[] = ["on_track", "concern", "off_track", "unclear"];

export const UNCLEAR: BabysitVerdict = {
	status: "unclear",
	confidence: 0,
	summary: "The babysitter could not produce a reliable judgment.",
	evidence: [],
	recommendation: "No action taken.",
};

export function parseVerdict(raw: string): BabysitVerdict {
	const text = raw.trim();
	if (!text) return UNCLEAR;

	// Attempt 1: strict JSON.
	let obj: unknown = null;
	try {
		obj = JSON.parse(text);
	} catch {
		obj = extractFencedJson(text);
	}

	const verdict = coerceVerdict(obj);
	if (verdict) return verdict;

	return { ...UNCLEAR, summary: `${UNCLEAR.summary} The model response was not valid JSON.` };
}

/** Pull the first JSON object out of a ```json ... ``` (or bare ```) fenced block. */
export function extractFencedJson(text: string): unknown {
	const fence = /```(?:json)?\s*([\s\S]*?)```/g;
	for (const m of text.matchAll(fence)) {
		const body = m[1]?.trim();
		if (!body) continue;
		try {
			return JSON.parse(body);
		} catch {
			// try the next fence
		}
	}
	return null;
}

/** Validate an unknown value as a BabysitVerdict. Returns undefined when invalid. */
export function coerceVerdict(obj: unknown): BabysitVerdict | undefined {
	if (typeof obj !== "object" || obj === null) return undefined;
	const o = obj as Record<string, unknown>;

	const status = o.status;
	if (typeof status !== "string" || !STATUSES.includes(status as VerdictStatus)) return undefined;

	const confidence = o.confidence;
	if (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
		return undefined;
	}

	const summary = typeof o.summary === "string" ? o.summary : undefined;
	if (summary === undefined) return undefined;

	let evidence: string[] = [];
	if (o.evidence !== undefined) {
		if (!Array.isArray(o.evidence) || !o.evidence.every((e) => typeof e === "string")) return undefined;
		evidence = o.evidence;
	}

	const recommendation = typeof o.recommendation === "string" ? o.recommendation : "";

	return { status: status as VerdictStatus, confidence, summary, evidence, recommendation };
}

export function verdictStatusLabel(status: VerdictStatus): string {
	return status;
}
