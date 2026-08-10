/**
 * `@file/...` reference parsing, resolution, loading, and hashing.
 *
 * Syntax: whitespace-delimited `@file/path` tokens in the command argument
 * string. Relative paths resolve against `ctx.cwd`; absolute paths are kept
 * as-is. Contents land in the stable prefix, deduplicated first-seen order.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export interface LoadedReference {
	/** Absolute resolved path. */
	absPath: string;
	/** Display path: relative to cwd when inside it, otherwise absolute. */
	displayPath: string;
	content: string;
	/** Content hash; changes force a prefix rebuild. */
	hash: string;
	size: number;
}

const FILE_REF_RE = /@file\/(\S+)/g;

/** Find all `@file/...` tokens in an argument string, in order. */
export function parseFileReferences(args: string): string[] {
	const refs: string[] = [];
	for (const m of args.matchAll(FILE_REF_RE)) {
		const ref = m[1];
		if (ref && ref.length > 0) refs.push(ref);
	}
	return refs;
}

/** Resolve a reference against cwd. Absolute paths are preserved. */
export function resolveReference(ref: string, cwd: string): string {
	if (path.isAbsolute(ref)) return ref;
	return path.resolve(cwd, ref);
}

/** Load a file as a reference, enforcing a per-file size limit. Throws on error. */
export function loadReference(absPath: string, maxBytes: number): LoadedReference {
	const stat = fs.statSync(absPath);
	if (!stat.isFile()) throw new Error(`not a file: ${absPath}`);
	if (stat.size > maxBytes) {
		throw new Error(
			`reference too large (${stat.size} bytes > ${maxBytes} limit): ${absPath} — raise maxFileBytes or drop the file`,
		);
	}
	const content = fs.readFileSync(absPath, "utf8");
	return {
		absPath,
		displayPath: absPath,
		content,
		hash: hashString(content),
		size: stat.size,
	};
}

/** Resolve + load a parsed reference. Throws on missing/invalid files. */
export function loadReferenceFrom(ref: string, cwd: string, maxBytes: number): LoadedReference {
	const abs = resolveReference(ref, cwd);
	return loadReference(abs, maxBytes);
}

/** Deduplicate references, preserving first-seen order (by resolved path). */
export function dedupeReferences(refs: string[], cwd: string): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const ref of refs) {
		const key = path.isAbsolute(ref) ? ref : path.resolve(cwd, ref);
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(ref);
	}
	return out;
}

/** FNV-1a 64-bit hash as a hex string. Deterministic and cheap. */
export function hashString(s: string): string {
	let h0 = 0xcbf29ce4;
	let h1 = 0x84222325;
	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i);
		h0 = Math.imul(h0 ^ c, 0x01000193) >>> 0;
		h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
	}
	return h0.toString(16).padStart(8, "0") + h1.toString(16).padStart(8, "0");
}
