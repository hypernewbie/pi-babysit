/**
 * Display helpers: notifications with a console fallback for headless modes.
 *
 * `ctx.ui.notify()` is a no-op in print/json modes, so commands and checks
 * must also write a concise line to stdout/stderr when `ctx.hasUI` is false.
 */

export type NotifyType = "info" | "warning" | "error";

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

/** Verbose logging only useful in terminal output; always console. */
export function log(message: string): void {
	console.log(`[babysit] ${message}`);
}

export function logError(message: string): void {
	console.error(`[babysit] ${message}`);
}
