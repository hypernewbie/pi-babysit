import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	parseFileReferences,
	resolveReference,
	loadReference,
	loadReferenceFrom,
	dedupeReferences,
	hashString,
} from "../src/file-references.ts";

function tmpdir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "babysit-ref-"));
}

test("parseFileReferences finds tokens in order", () => {
	assert.deepEqual(parseFileReferences("now @file/RULEZ.md and @file/a b.md"), ["RULEZ.md", "a"]);
	assert.deepEqual(parseFileReferences("no refs here"), []);
	assert.deepEqual(parseFileReferences("@file/"), []);
});

test("resolveReference resolves relative and keeps absolute", () => {
	assert.equal(resolveReference("RULEZ.md", "/proj"), "/proj/RULEZ.md");
	assert.equal(resolveReference("./x/y.md", "/proj"), "/proj/x/y.md");
	assert.equal(resolveReference("/tmp/notes.md", "/proj"), "/tmp/notes.md");
});

test("loadReference reads content and hashes it", () => {
	const dir = tmpdir();
	const f = path.join(dir, "r.md");
	fs.writeFileSync(f, "alpha beta");
	const loaded = loadReference(f, 1024);
	assert.equal(loaded.content, "alpha beta");
	assert.equal(loaded.size, 10);
	assert.equal(loaded.hash, hashString("alpha beta"));
	fs.rmSync(dir, { recursive: true, force: true });
});

test("loadReference enforces size limit", () => {
	const dir = tmpdir();
	const f = path.join(dir, "big.md");
	fs.writeFileSync(f, "x".repeat(500));
	assert.throws(() => loadReference(f, 100), /too large/);
	fs.rmSync(dir, { recursive: true, force: true });
});

test("loadReference throws on missing file", () => {
	assert.throws(() => loadReference("/definitely/missing.md", 1024));
});

test("loadReferenceFrom resolves against cwd", () => {
	const dir = tmpdir();
	fs.writeFileSync(path.join(dir, "r.md"), "hello");
	const loaded = loadReferenceFrom("r.md", dir, 1024);
	assert.equal(loaded.content, "hello");
	fs.rmSync(dir, { recursive: true, force: true });
});

test("dedupeReferences preserves first-seen order", () => {
	const dir = tmpdir();
	const refs = ["a.md", "b.md", "./a.md"];
	assert.deepEqual(dedupeReferences(refs, dir), ["a.md", "b.md"]);
	fs.rmSync(dir, { recursive: true, force: true });
});

test("hashString is deterministic and distinguishes inputs", () => {
	assert.equal(hashString("abc"), hashString("abc"));
	assert.notEqual(hashString("abc"), hashString("abd"));
	assert.equal(hashString(""), hashString(""));
});

test("reference content changes change the hash", () => {
	const dir = tmpdir();
	const f = path.join(dir, "r.md");
	fs.writeFileSync(f, "v1");
	const a = loadReference(f, 1024);
	fs.writeFileSync(f, "v2");
	const b = loadReference(f, 1024);
	assert.notEqual(a.hash, b.hash);
	fs.rmSync(dir, { recursive: true, force: true });
});
