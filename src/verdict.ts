/**
 * Strict-but-tolerant verdict parsing for the babysitter model response.
 *
 * Contract (from the plan):
 * 1. Parse strict JSON first.
 * 2. Extract a single JSON object from a fenced code block.
 * 3. Extract an embedded JSON object from surrounding prose.
 * 4. Repair control characters inside string literals.
 * 5. Validate enum values, confidence range, and string/array fields.
 * 6. Treat malformed output as `unclear`, never as `off_track`, and include
 *    a snippet of the raw response so failures are debuggable.
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
		obj = null;
	}

	// Attempt 2: JSON inside a fenced code block.
	if (obj === null) obj = extractFencedJson(text);

	// Attempt 3: JSON embedded in prose (first { ... last }).
	if (obj === null) obj = extractEmbeddedJson(text);

	// Attempt 4: repaired JSON (escaped control characters in strings).
	if (obj === null) {
		try {
			obj = JSON.parse(repairControlChars(text));
		} catch {
			obj = null;
		}
	}

	const verdict = coerceVerdict(obj);
	if (verdict) return verdict;

	const snippet = truncateOneLine(text, 160);
	return {
		...UNCLEAR,
		summary: `${UNCLEAR.summary} The model response was not valid JSON${snippet ? `: ${snippet}` : ""}.`,
	};
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

/** Pull the first JSON object out of surrounding prose (first { to last }). */
export function extractEmbeddedJson(text: string): unknown {
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	if (start === -1 || end === -1 || end <= start) return null;
	const candidate = text.slice(start, end + 1);
	try {
		return JSON.parse(candidate);
	} catch {
		return null;
	}
}

/**
 * Escape raw control characters inside string literals so the JSON parses.
 * Models sometimes emit literal newlines/tabs inside string values.
 */
export function repairControlChars(json: string): string {
	let repaired = "";
	let inString = false;
	for (const char of json) {
		if (!inString) {
			repaired += char;
			if (char === '"') inString = true;
			continue;
		}
		if (char === '"') {
			repaired += char;
			inString = false;
			continue;
		}
		if (char === "\\") {
			// keep the backslash; the next char is handled normally
			repaired += char;
			continue;
		}
		const code = char.codePointAt(0);
		if (code !== undefined && code <= 0x1f) {
			switch (char) {
				case "\b":
					repaired += "\\b";
					break;
				case "\f":
					repaired += "\\f";
					break;
				case "\n":
					repaired += "\\n";
					break;
				case "\r":
					repaired += "\\r";
					break;
				case "\t":
					repaired += "\\t";
					break;
				default:
					repaired += `\\u${code.toString(16).padStart(4, "0")}`;
			}
		} else {
			repaired += char;
		}
	}
	return repaired;
}

/** Validate an unknown value as a BabysitVerdict. Returns undefined when invalid. */
export function coerceVerdict(obj: unknown): BabysitVerdict | undefined {
	if (typeof obj !== "object" || obj === null) return undefined;
	const o = obj as Record<string, unknown>;

	const status = typeof o.status === "string" ? o.status.trim().toLowerCase() : "";
	if (!STATUSES.includes(status as VerdictStatus)) return undefined;

	// Confidence: default 0.5 when omitted; invalid values reject the verdict.
	let confidence = 0.5;
	if (o.confidence !== undefined) {
		const c = o.confidence;
		if (typeof c !== "number" || !Number.isFinite(c) || c < 0 || c > 1) return undefined;
		confidence = c;
	}

	const summary = typeof o.summary === "string" ? o.summary.trim() : "";
	if (!summary) return undefined;

	let evidence: string[] = [];
	if (o.evidence !== undefined) {
		if (!Array.isArray(o.evidence) || !o.evidence.every((e) => typeof e === "string")) return undefined;
		evidence = o.evidence;
	}

	const recommendation = typeof o.recommendation === "string" ? o.recommendation : "";

	return { status: status as VerdictStatus, confidence, summary, evidence, recommendation };
}

function truncateOneLine(s: string, max: number): string {
	const t = s.replace(/\s+/g, " ").trim();
	return t.length <= max ? t : t.slice(0, max).trimEnd() + "…";
}

export function verdictStatusLabel(status: VerdictStatus): string {
	return status;
}
