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
}

export interface ActivityResult {
	/** Chronological, bounded text. */
	text: string;
	/** Number of normalized entries dropped by the budget. */
	dropped: number;
	/** True when the tail was truncated by the budget (kept for status diagnostics). */
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
		// thinking / reasoning / toolCall / toolResult blocks are excluded on
		// purpose: the eval sees conversation only.
	}
	return parts.join("\n");
}

function truncate(s: string, max: number): string {
	if (s.length <= max) return s;
	return s.slice(0, max) + "…";
}

/**
 * Normalize session entries into ordered, text-only events.
 *
 * Only user and assistant text is kept. Tool calls, tool results, and any
 * tool-related content are excluded entirely: the check evaluates the
 * conversation, not what tools were used.
 */
export function normalizeEntries(entries: ActivityEntry[], opts: ActivityOptions): { events: NormalizedEvent[] } {
	const events: NormalizedEvent[] = [];

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
				if (text) events.push({ text: `Assistant: ${text}`, isUser: false });
			}
			// toolResult and other roles: excluded.
		} else if (entry.type === "compaction") {
			const summary = entry.summary?.trim();
			if (summary) events.push({ text: `[context compacted] ${truncate(summary, 4000)}`, isUser: false });
		} else if (entry.type === "branch_summary") {
			const summary = entry.summary?.trim();
			if (summary) events.push({ text: `[abandoned branch] ${truncate(summary, 2000)}`, isUser: false });
		}
		// custom / label / toolResult / tool calls / model_change / thinking_level_change / session_info: ignored.
	}

	return { events };
}

/**
 * Build a bounded activity tail: keep entries newest-first until the budget
 * is exhausted (only the newest user message is force-kept), then emit in
 * chronological order. Conversation only — no tool content.
 */
export function buildActivityTail(entries: ActivityEntry[], opts: ActivityOptions): ActivityResult {
	const { events } = normalizeEntries(entries, opts);
	if (events.length === 0) return { text: "(no recent activity)", dropped: 0, truncated: false };

	let budget = opts.maxChars;
	let dropped = 0;
	let newestUserKept = false;
	const claimed: NormalizedEvent[] = [];
	for (let i = events.length - 1; i >= 0; i--) {
		const ev = events[i]!;
		if (ev.isUser && !newestUserKept) {
			claimed.push(ev);
			newestUserKept = true;
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
	return { text, dropped, truncated: false };
}
