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
 *   /babysit on --model x/y check this carefully @file/RULEZ.md
 *
 * Any text that is not a subcommand, flag, or `@file/...` reference becomes
 * the check instruction (also available explicitly as `--instruction ...`).
 * The instruction is kept stable and included in the babysitter prefix.
 */

import { parseFileReferences } from "./file-references.ts";

export type Subcommand = "now" | "on" | "off" | "status";

export interface ParsedCommand {
	subcommand: Subcommand;
	refs: string[];
	every?: number;
	model?: string;
	tailTokens?: number;
	/** Custom instruction for the check, from bare text or --instruction. */
	instruction?: string;
}

const SUBCOMMANDS = new Set<Subcommand>(["now", "on", "off", "status"]);

function parseIntArg(raw: string | undefined): number | undefined {
	if (!raw) return undefined;
	const n = Number.parseInt(raw, 10);
	return Number.isFinite(n) && n > 0 ? n : undefined;
}

function isFlag(tok: string): boolean {
	return tok.startsWith("--");
}

function isRef(tok: string): boolean {
	return tok.startsWith("@file/");
}

/** Parse a `/babysit` argument string. Never throws. */
export function parseCommand(args: string): ParsedCommand {
	const tokens = args.trim().split(/\s+/).filter(Boolean);

	let subcommand: Subcommand = "now";
	let every: number | undefined;
	let model: string | undefined;
	let tailTokens: number | undefined;
	const instructionWords: string[] = [];
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
		} else if (tok === "--instruction") {
			// Collect following tokens until the next flag or @file reference.
			while (cursor + 1 < tokens.length && !isFlag(tokens[cursor + 1]!) && !isRef(tokens[cursor + 1]!)) {
				instructionWords.push(tokens[++cursor]!);
			}
		} else if (isRef(tok)) {
			// references are collected separately by parseFileReferences()
		} else if (!isFlag(tok)) {
			// Bare text is the instruction.
			instructionWords.push(tok);
		}
	}

	const instruction = instructionWords.length > 0 ? instructionWords.join(" ") : undefined;

	return {
		subcommand,
		refs: parseFileReferences(args),
		every,
		model,
		tailTokens,
		instruction,
	};
}
