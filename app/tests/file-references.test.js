import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync, realpathSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileReferences, createFileReferences, isFileReference } from "../lib/file-references.js";
import { Inbox } from "../lib/inbox.js";
import { AppError } from "../lib/errors.js";
import { writeJson } from "../lib/files.js";

function folder(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "case-forge-reference-test-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
const id = text => createHash("sha256").update(text).digest("hex");
function inbox(t, options = {}) {
  const value = new Inbox({ providers: {}, assertWritable: () => {}, extract: async bytes => [{ page: 1, text: bytes.toString("utf8") }], ...options });
  t.after(async () => { value.close(); await value.tail; });
  return value;
}

test("profile file numbers survive restart and repeat imports without consuming a new number", t => {
  const root = folder(t), references = createFileReferences({ root });
  assert.deepEqual(readdirSync(root), [], "Construction must not initialize or alter a profile");
  const first = references.allocate(id("first"));
  assert.match(first, /^CF-[A-F0-9]{12}-000001$/);
  assert.equal(isFileReference(first), true);
  assert.equal(references.allocate(id("first")), first);
  const restarted = new FileReferences({ root });
  assert.equal(restarted.allocate(id("first")), first);
  const second = restarted.allocate(id("second"));
  assert.equal(second, first.replace(/000001$/, "000002"));
  const third = references.allocate(id("third"));
  assert.equal(third, first.replace(/000001$/, "000003"), "An older allocator must reread the latest registry");
  assert.equal(JSON.parse(readFileSync(join(root, "file-references.json"))).nextNumber, 4);
});

test("distinct profiles allocate distinct prefixes for identical document contents", t => {
  const first = new FileReferences({ root: folder(t) }).allocate(id("same file"));
  const second = new FileReferences({ root: folder(t) }).allocate(id("same file"));
  assert.notEqual(first, second);
  assert.ok(first.endsWith("-000001") && second.endsWith("-000001"));
});

test("a damaged register fails closed rather than resetting or reusing numbers", t => {
  const root = folder(t), references = new FileReferences({ root });
  const first = references.allocate(id("one"));
  const path = join(root, "file-references.json");
  const good = JSON.parse(readFileSync(path, "utf8"));
  for (const damage of ["{unreadable", JSON.stringify({ ...good, nextNumber: 1 }), JSON.stringify({ ...good, nextNumber: 3, references: { [id("one")]: first, [id("other")]: first } })]) {
    writeFileSync(path, damage);
    assert.throws(() => references.allocate(id("new")), /needs recovery/);
    assert.equal(readFileSync(path, "utf8"), damage, "Allocation must preserve damaged evidence for recovery");
  }
  assert.throws(() => references.allocate("../../wrong"), /valid document/);
  assert.equal(isFileReference("CF-123456789ABC-000000"), false);
  assert.equal(isFileReference("CF-123456789ABC-0000010"), false);
});

test("shared profile allocator numbers files across cases and retains content identity", async t => {
  const root = folder(t), otherCase = folder(t), profile = folder(t);
  const documents = inbox(t, { fileReferences: new FileReferences({ root: profile }) });
  const one = documents.import(root, "one.txt", Buffer.from("Fictional first letter."));
  await documents.tail;
  const duplicate = documents.import(root, "renamed.txt", Buffer.from("Fictional first letter."));
  const otherCopy = documents.import(otherCase, "one-copy.txt", Buffer.from("Fictional first letter."));
  await documents.tail;
  const two = documents.import(otherCase, "two.txt", Buffer.from("Fictional second letter."));
  await documents.tail;
  assert.equal(one.document.id, id("Fictional first letter."), "SHA remains the internal content identity");
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.document.reference, one.document.reference);
  assert.equal(otherCopy.document.reference, one.document.reference);
  assert.equal(two.document.reference, one.document.reference.replace(/000001$/, "000002"));
  assert.equal(documents.detail(root, one.document.id).reference, one.document.reference);
  assert.equal(JSON.parse(readFileSync(join(root, ".strategist/documents", one.document.id, "document.json"))).reference, one.document.reference);
  assert.equal(existsSync(join(root, ".strategist/file-references.json")), false, "Desktop profile allocator takes precedence over a case-local fallback");
});

test("legacy reference backfill is writable-only, preserves timestamps, and survives restart", async t => {
  const root = folder(t), documentId = id("Legacy fictional note.");
  const path = `.strategist/documents/${documentId}/document.json`;
  const record = { id: documentId, name: "legacy.txt", original: `.strategist/documents/${documentId}/original.txt`, extension: ".txt", bytes: 22, status: "ready", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
  writeJson(root, path, record);
  const before = readFileSync(join(root, path), "utf8");
  let allocations = 0;
  const readonly = inbox(t, { assertWritable: () => { throw new AppError("Read-only workspace", 403); }, fileReferences: { allocate: () => { allocations++; throw new Error("Must not run"); } } });
  assert.equal(readonly.list(root)[0].reference, undefined);
  assert.equal(readonly.detail(root, documentId).reference, undefined);
  assert.equal(allocations, 0);
  assert.equal(readFileSync(join(root, path), "utf8"), before);
  assert.equal(existsSync(join(root, ".strategist/file-references.json")), false);
  const writable = inbox(t), numbered = writable.list(root)[0];
  assert.ok(isFileReference(numbered.reference));
  assert.equal(numbered.updatedAt, record.updatedAt);
  const restarted = inbox(t);
  assert.equal(restarted.detail(root, documentId).reference, numbered.reference);
  assert.equal(readonly.list(root)[0].reference, numbered.reference, "Read-only users may view an already persisted reference");
});

test("a copied case keeps its already assigned reference without rewriting the record", t => {
  const root = folder(t), documentId = id("Portable file.");
  const record = { id: documentId, reference: "CF-123456789ABC-000042", name: "portable.txt", createdAt: "2026-01-01T00:00:00Z", status: "ready" };
  const path = `.strategist/documents/${documentId}/document.json`;
  writeJson(root, path, record);
  const before = readFileSync(join(root, path), "utf8");
  const documents = inbox(t, { fileReferences: { allocate: () => { throw new Error("Existing references must be preserved"); } } });
  assert.equal(documents.list(root)[0].reference, record.reference);
  assert.equal(readFileSync(join(root, path), "utf8"), before);
});

test("a broken allocator cannot hide a readable legacy document", t => {
  const root = folder(t), documentId = id("Old source.");
  writeJson(root, `.strategist/documents/${documentId}/document.json`, { id: documentId, name: "old.txt", createdAt: "2026-01-01T00:00:00Z", status: "ready" });
  const documents = inbox(t, { fileReferences: { allocate: () => { throw new AppError("Registry needs recovery", 409); } } });
  assert.equal(documents.list(root)[0].id, documentId);
  assert.equal(documents.detail(root, documentId).name, "old.txt");
});
