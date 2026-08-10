/**
 * Babysitter configuration: defaults, arg overrides, and optional
 * `.pi/babysit.json` project config.
 */

export interface BabysitConfig {
	/** "provider/model-id" to use for checks. Required to run a check. */
	model: string;
	/** Run an automatic check after this many completed main-session tool executions. */
	everyToolCalls: number;
	/** Estimated token budget for the dynamic activity tail. */
	tailTokens: number;
	/** Whether automatic monitoring is enabled at session start. */
	enabled: boolean;
	/** @file references always included in the prefix (from project config). */
	rules: string[];
	/** Per-file size limit when reading @file references. */
	maxFileBytes: number;
	/** Total size limit across all reference files in one prefix. */
	maxTotalRefBytes: number;
	/** Max characters kept from a single tool result in the activity tail. */
	maxToolResultChars: number;
	/** Max tool results kept per normalized message. */
	maxToolResults: number;
	/** Persist each verdict as a non-LLM custom session entry. */
	persistVerdicts: boolean;
	/** Also run a pending check at agent_settled (after the whole run settles). */
	runAfterSettle: boolean;
	/** Provider prompt-cache retention hint. "long" costs more on write. */
	cacheRetention: "none" | "short" | "long";
}

export const DEFAULT_CONFIG: BabysitConfig = {
	model: "",
	everyToolCalls: 5,
	tailTokens: 6000,
	enabled: false,
	rules: [],
	maxFileBytes: 64 * 1024,
	maxTotalRefBytes: 128 * 1024,
	maxToolResultChars: 4000,
	maxToolResults: 3,
	persistVerdicts: false,
	runAfterSettle: false,
	cacheRetention: "short",
};

export type PartialConfig = Partial<BabysitConfig>;

export function mergeConfig(...partials: (PartialConfig | undefined)[]): BabysitConfig {
	const out: BabysitConfig = { ...DEFAULT_CONFIG };
	for (const p of partials) {
		if (!p) continue;
		for (const [k, v] of Object.entries(p)) {
			if (v !== undefined) (out as unknown as Record<string, unknown>)[k] = v;
		}
	}
	return out;
}

/** Split "provider/model-id" into its parts. Returns undefined when malformed. */
export function splitModelId(model: string): { provider: string; modelId: string } | undefined {
	const slash = model.indexOf("/");
	if (slash <= 0 || slash === model.length - 1) return undefined;
	const provider = model.slice(0, slash);
	const id = model.slice(slash + 1);
	if (!provider || !id) return undefined;
	return { provider, modelId: id };
}

/** Parse a non-negative integer argument; undefined when missing or invalid. */
export function parsePositiveInt(raw: string | undefined, fallback: number): number {
	if (!raw) return fallback;
	const n = Number.parseInt(raw, 10);
	return Number.isFinite(n) && n > 0 ? n : fallback;
}
