/**
 * Shared types for pi-babysit.
 *
 * These are plain structural types so pure modules (and their tests) never
 * need the Pi runtime installed — only typechecking does.
 */

export type VerdictStatus = "on_track" | "concern" | "off_track" | "unclear";

export interface BabysitVerdict {
	status: VerdictStatus;
	/** 0..1. Confidence in the judgment. */
	confidence: number;
	summary: string;
	evidence: string[];
	recommendation: string;
}

/** Cumulative babysitter usage across all checks in this session. */
export interface UsageTotals {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
}

export function emptyUsage(): UsageTotals {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
}

/** Single check result, for display and /babysit status. */
export interface CheckResult {
	verdict: BabysitVerdict;
	checkIndex: number;
	modelId: string;
	usage: UsageTotals;
	cacheRead: number;
	cacheWrite: number;
	durationMs: number;
}

/**
 * Mutable extension state for one active Pi session. Reset on session_start /
 * session replacement; never shared across sessions.
 */
export interface BabysitState {
	enabled: boolean;
	everyToolCalls: number;
	toolCallsSinceCheck: number;
	pendingCheck: boolean;
	checkInFlight: boolean;
	checkCount: number;
	modelId?: string;
	activeSessionId?: string;
	lastCheckedLeafId?: string;
	lastVerdict?: BabysitVerdict;
	lastCheckError?: string;
	lastCheckAt?: number;
	/** Rolling summary of recent activity, kept in the dynamic suffix. */
	activitySummary?: string;
	/** Hash of the current stable prefix; changes force a fresh provider write. */
	prefixHash?: string;
	/** Baseline user intent, captured once per session. */
	intent?: string;
	/** Custom instruction for checks, set from the command (stable prefix). */
	instruction?: string;
	/** Referenced files currently baked into the prefix. */
	referencedFiles: string[];
	/** Last activity tail size/truncation, for /babysit status diagnostics. */
	lastTailLen?: number;
	lastTailTruncated?: boolean;
	usage: UsageTotals;
	abortController?: AbortController;
}
