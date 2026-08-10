/**
 * Tool-count scheduler for automatic checks.
 *
 * Semantics (from the plan):
 * - `tool_execution_end` increments the counter.
 * - When the counter reaches `every`, a check becomes pending.
 * - At `turn_end` (after completed tool execution, before the next model
 *   turn), exactly one awaited check runs if one is pending.
 * - After a check, only the remainder is retained (`count %= every`), so a
 *   parallel batch that crossed the threshold multiple times never triggers
 *   duplicate checks over the same snapshot.
 */

export class ToolCounter {
	private _count = 0;
	private _pending = false;
	private _inFlight = false;
	private _enabled = true;
	private _every: number;

	constructor(every: number) {
		this._every = every;
	}

	get count(): number {
		return this._count;
	}

	get pending(): boolean {
		return this._pending;
	}

	get inFlight(): boolean {
		return this._inFlight;
	}

	get every(): number {
		return this._every;
	}

	get enabled(): boolean {
		return this._enabled;
	}

	setEnabled(enabled: boolean): void {
		this._enabled = enabled;
		if (!enabled) {
			this._count = 0;
			this._pending = false;
		}
	}

	setEvery(n: number): void {
		this._every = n;
		this._count = 0;
		this._pending = false;
	}

	/** Record one completed tool execution. */
	countTool(): void {
		if (!this._enabled || this._every <= 0) return;
		this._count++;
		if (this._count >= this._every) {
			this._pending = true;
		}
	}

	/**
	 * Claim the pending check. Returns true when a check should run now.
	 * Only one check can be in flight at a time.
	 */
	beginCheck(): boolean {
		if (!this._pending || this._inFlight) return false;
		this._inFlight = true;
		return true;
	}

	/**
	 * Finish a check. Retains the remainder, so a batch that crossed the
	 * threshold twice keeps a pending check for the next turn_end.
	 */
	finishCheck(): void {
		this._inFlight = false;
		this._count %= this._every;
		this._pending = this._count >= this._every;
	}

	/** Abort an in-flight check without resetting counts (used on shutdown). */
	releaseInFlight(): void {
		this._inFlight = false;
	}

	reset(): void {
		this._count = 0;
		this._pending = false;
		this._inFlight = false;
	}
}
