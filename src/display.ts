/**
 * Display helpers: notifications + persistent footer status, with a console
 * fallback for headless modes.
 *
 * `ctx.ui.notify()` is a no-op in print/json modes, so commands and checks
 * must also write a concise line to stdout/stderr when `ctx.hasUI` is false.
 * `ctx.ui.setStatus()` keeps a persistent one-line status in the TUI footer.
 */

export type NotifyType = "info" | "warning" | "error";

/** Baby emoji brand mark for babysit status lines. */
export const BABY = "👶";

export interface NotifySink {
	hasUI: boolean;
	ui: { notify(message: string, type?: NotifyType): void };
}

export function notify(ctx: NotifySink, message: string, type: NotifyType = "info"): void {
	if (ctx.hasUI) {
		ctx.ui.notify(message, type);
		return;
	}
	const level = type === "error" ? "error" : "log";
	const tag = `[babysit:${type}]`;
	console[level](`${tag} ${message}`);
}

/** Set the persistent "babysit" footer status line (TUI) or stdout (headless). */
export function setStatus(
	ctx: NotifySink & { ui: { setStatus?(key: string, text?: string): void } },
	text: string | undefined,
): void {
	if (ctx.hasUI && typeof ctx.ui.setStatus === "function") {
		ctx.ui.setStatus("babysit", text);
		return;
	}
	if (text) console.log(`[babysit] ${text}`);
}

/** One-line truncation with an ellipsis. */
export function truncate(s: string, max: number): string {
	const t = s.replace(/\s+/g, " ").trim();
	return t.length <= max ? t : t.slice(0, max).trimEnd() + "…";
}

/** Verbose logging only useful in terminal output; always console. */
export function log(message: string): void {
	console.log(`[babysit] ${message}`);
}

export function logError(message: string): void {
	console.error(`[babysit] ${message}`);
}
