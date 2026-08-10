/**
 * Session activity normalization and tail bounding.
 *
 * Consumes the active session context (from
 * `ctx.sessionManager.buildContextEntries()`) and produces a bounded,
 * chronological activity summary for the dynamic suffix. Tool schemas,
 * thinking blocks, and full tool serializations are stripped or truncated.
 *
 * The input type is deliberately structural so tests (and node's runtime)
 * never need the Pi package installed.
 */

export interface ActivityEntry {
	type: string;
	message?: {
		role?: string;
		content?: unknown;
		toolName?: string;
		isError?: boolean;
	};
	/** compaction / branch_summary summaries. */
	summary?: string;
}

export interface ActivityOptions {
	/** Maximum total characters in the tail (~4 chars/token). */
	maxChars: number;
	/** Maximum characters kept from a single tool result. */
	maxToolResultChars: number;
	/** Maximum tool results kept per normalized message. */
	maxToolResults: number;
}

export interface ActivityResult {
	/** Chronological, bounded text. */
	text: string;
	/** Number of normalized entries dropped by the budget. */
	dropped: number;
	/** True when any tool result was truncated. */
	truncated: boolean;
}

interface NormalizedEvent {
	text: string;
	isUser: boolean;
}

type ContentBlock = {
	type?: string;
	text?: string;
	name?: string;
	arguments?: unknown;
	toolName?: string;
	isError?: boolean;
};

/** Extract visible text from message content (string or block array). */
export function contentText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const part of content) {
		if (!part || typeof part !== "object") continue;
		const block = part as ContentBlock;
		if (block.type === "text" && typeof block.text === "string") {
			parts.push(block.text);
		}
		// thinking / reasoning blocks are stripped on purpose.
	}
	return parts.join("\n");
}

/** Compact a toolCall block into "name(args)" with truncated JSON args. */
function toolCallText(block: ContentBlock, maxArgs: number): string {
	let args = "";
	if (block.arguments !== undefined) {
		try {
			args = JSON.stringify(block.arguments);
		} catch {
			args = String(block.arguments);
		}
	}
	if (args.length > maxArgs) {
		args = args.slice(0, maxArgs) + "…";
	}
	const name = block.name || "tool";
	return `→ ${name}(${args})`;
}

function truncate(s: string, max: number): string {
	if (s.length <= max) return s;
	return s.slice(0, max) + "…";
}

function extractToolCallLines(content: unknown): string[] {
	if (!Array.isArray(content)) return [];
	const lines: string[] = [];
	for (const part of content) {
		if (!part || typeof part !== "object") continue;
		const block = part as ContentBlock;
		if (block.type === "toolCall") {
			lines.push(toolCallText(block, 300));
		}
	}
	return lines;
}

/**
 * Normalize session entries into ordered, text-only events.
 * Returns the events plus a flag for any truncated tool result.
 */
export function normalizeEntries(entries: ActivityEntry[], opts: ActivityOptions): { events: NormalizedEvent[]; truncated: boolean } {
	const events: NormalizedEvent[] = [];
	let truncated = false;

	for (const entry of entries) {
		if (entry.type === "message") {
			const msg = entry.message;
			if (!msg) continue;
			const role = msg.role;

			if (role === "user") {
				const text = contentText(msg.content).trim();
				if (text) events.push({ text: `User: ${text}`, isUser: true });
			} else if (role === "assistant") {
				const text = contentText(msg.content).trim();
				const toolCalls = extractToolCallLines(msg.content);
				const parts: string[] = [];
				if (text) parts.push(text);
				parts.push(...toolCalls);
				const joined = parts.join("\n").trim();
				if (joined) events.push({ text: `Assistant: ${joined}`, isUser: false });
			} else if (role === "toolResult") {
				const toolName = msg.toolName ?? "tool";
				const raw = contentText(msg.content).trim();
				const isError = msg.isError === true;
				if (raw.length > opts.maxToolResultChars) truncated = true;
				const truncatedResult = truncate(raw, opts.maxToolResultChars);
				const flag = isError ? " (ERROR)" : "";
				const text = raw ? `Tool ${toolName}${flag}: ${truncatedResult}` : `Tool ${toolName}${flag}`;
				events.push({ text, isUser: false });
			}
		} else if (entry.type === "compaction") {
			const summary = entry.summary?.trim();
			if (summary) events.push({ text: `[context compacted] ${truncate(summary, 4000)}`, isUser: false });
		} else if (entry.type === "branch_summary") {
			const summary = entry.summary?.trim();
			if (summary) events.push({ text: `[abandoned branch] ${truncate(summary, 2000)}`, isUser: false });
		}
		// custom / label / model_change / thinking_level_change / session_info: ignored.
	}

	// Cap consecutive tool results per run.
	const kept: NormalizedEvent[] = [];
	let toolResultRun = 0;
	for (const ev of events) {
		if (ev.text.startsWith("Tool ")) {
			toolResultRun++;
			if (toolResultRun > opts.maxToolResults) continue;
		} else {
			toolResultRun = 0;
		}
		kept.push(ev);
	}

	return { events: kept, truncated };
}

/**
 * Build a bounded activity tail: keep entries newest-first until the budget
 * is exhausted (user messages always kept), then emit in chronological order.
 */
export function buildActivityTail(entries: ActivityEntry[], opts: ActivityOptions): ActivityResult {
	const { events, truncated } = normalizeEntries(entries, opts);
	if (events.length === 0) return { text: "(no recent activity)", dropped: 0, truncated: false };

	let budget = opts.maxChars;
	let dropped = 0;

	// Walk newest-first, claiming budget. User messages always survive.
	const claimed: NormalizedEvent[] = [];
	for (let i = events.length - 1; i >= 0; i--) {
		const ev = events[i]!;
		if (ev.isUser) {
			claimed.push(ev);
			continue;
		}
		if (ev.text.length <= budget) {
			budget -= ev.text.length;
			claimed.push(ev);
		} else {
			dropped++;
		}
	}

	claimed.reverse();
	const text = claimed.map((e) => e.text).join("\n");
	return { text, dropped, truncated };
}
