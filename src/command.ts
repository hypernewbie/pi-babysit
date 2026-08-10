/**
 * `/babysit` command parsing and dispatch.
 *
 * Syntax:
 *   /babysit                      -> now
 *   /babysit now @file/RULEZ.md
 *   /babysit on --every 5 --model provider/model-id
 *   /babysit off
 *   /babysit status
 *   /babysit now --tail-tokens 6000
 */

import { parseFileReferences } from "./file-references.ts";

export type Subcommand = "now" | "on" | "off" | "status";

export interface ParsedCommand {
	subcommand: Subcommand;
	refs: string[];
	every?: number;
	model?: string;
	tailTokens?: number;
}

const SUBCOMMANDS = new Set<Subcommand>(["now", "on", "off", "status"]);

function parseIntArg(raw: string | undefined): number | undefined {
	if (!raw) return undefined;
	const n = Number.parseInt(raw, 10);
	return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Parse a `/babysit` argument string. Never throws. */
export function parseCommand(args: string): ParsedCommand {
	const tokens = args.trim().split(/\s+/).filter(Boolean);

	let subcommand: Subcommand = "now";
	let every: number | undefined;
	let model: string | undefined;
	let tailTokens: number | undefined;
	let cursor = 0;

	if (tokens.length > 0 && SUBCOMMANDS.has(tokens[0] as Subcommand)) {
		subcommand = tokens[0] as Subcommand;
		cursor = 1;
	}

	for (; cursor < tokens.length; cursor++) {
		const tok = tokens[cursor]!;
		if (tok === "--every") {
			every = parseIntArg(tokens[++cursor]);
		} else if (tok === "--model") {
			model = tokens[++cursor];
		} else if (tok === "--tail-tokens") {
			tailTokens = parseIntArg(tokens[++cursor]);
		}
		// other tokens are handled by parseFileReferences() below.
	}

	return {
		subcommand,
		refs: parseFileReferences(args),
		every,
		model,
		tailTokens,
	};
}
