import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FactRegistry } from "../lib/facts.js";

const statement = "The message records collection at 4:37 pm on 12 May 2025.";
const quote = "Here now. It's 4:37.";
function setup(t) {
  const folder = mkdtempSync(join(tmpdir(), "case-forge-facts-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  writeFileSync(join(folder, "sms.txt"), quote);
  const registry = new FactRegistry(folder);
  const input = { actor: "test-agent", statement, sources: [{ sourceId: "SMS-00342", path: "sms.txt", locator: "message 1", quote }] };
  const review = { expectedRevision: 1, reviewer: "Test reviewer", reason: "Checked original message and its context.", confirmVerified: true };
  const propose = () => registry.propose(input);
  const verify = () => { const fact = propose(); return registry.verify(fact.id, review); };
  return { folder, registry, input, review, propose, verify };
}

test("proposals cannot render; explicit review locks the exact wording with provenance", (t) => {
  const { registry, input, review } = setup(t);
  input.statement = ` ${statement}\nSecond line. `;
  const fact = registry.propose(input);
  assert.equal(fact.id, "FACT-00001");
  assert.throws(() => registry.render(`{{fact:${fact.id}}}`), /not a verified/);
  assert.throws(() => registry.verify(fact.id, { ...review, confirmVerified: false }), /human verification/);
  const verified = registry.verify(fact.id, review);
  assert.equal(verified.revisions[1].statement, input.statement);
  assert.equal(verified.revisions[1].sources[0].quoteChecked, true);
  assert.equal(verified.revisions[1].verification.reviewer, "Test reviewer");
  assert.equal(verified.revisions[0].status, "PROPOSED");
  assert.throws(() => registry.verify(fact.id, { ...review, expectedRevision: 2 }), /locked/);
  assert.equal(registry.read().events.length, 2);
});

test("correction review preserves the old fact, blocks live rendering, and propagates after acceptance", (t) => {
  const { folder, registry, input, review, verify } = setup(t);
  const fact = verify();
  const old = registry.get(fact.id).revisions[1];
  writeFileSync(join(folder, "chronology.md"), `# Chronology\n\n{{fact:${fact.id}}}\n`);
  writeFileSync(join(folder, "affidavit.md"), `# Draft\n\n{{fact:${fact.id}}}\n`);
  registry.export("chronology.md", "exports/first.md");
  writeFileSync(join(folder, "cctv.txt"), "Collection occurred at 4:42 pm.");
  const conflict = registry.conflict(fact.id, { ...input, expectedRevision: 2, statement: "Collection occurred at 4:42 pm.", reason: "CCTV timestamp differs from the message.", sources: [{ sourceId: "CCTV-00018", path: "cctv.txt", locator: "frame 18", quote: "Collection occurred at 4:42 pm." }] });
  assert.deepEqual(registry.get(fact.id).revisions[1], old);
  assert.throws(() => registry.render(`{{fact:${fact.id}}}`), /unresolved conflict/);
  assert.ok(registry.render(`{{fact:${fact.id}@2}}`).content.includes(statement));
  const resolved = registry.resolve(fact.id, { ...review, expectedRevision: 2, conflictId: conflict.id, decision: "accept" });
  assert.equal(resolved.revisions.length, 3);
  assert.deepEqual(resolved.revisions[1], old);
  for (const path of ["chronology.md", "affidavit.md"]) {
    const content = registry.render(readFileSync(join(folder, path), "utf8")).content;
    assert.ok(content.includes("Collection occurred at 4:42 pm."));
  }
  const audit = registry.check();
  assert.equal(audit.usages.length, 3);
  assert.ok(audit.issues.some((issue) => issue.type === "STALE_SNAPSHOT"));
  assert.ok(readFileSync(join(folder, "exports/first.md"), "utf8").includes(statement));
  assert.throws(() => registry.export("chronology.md", "exports/first.md"), /EEXIST/);
});

test("rejection records a reason without replacing the fact; stale reviews cannot win", (t) => {
  const { registry, input, review, verify } = setup(t);
  const fact = verify();
  assert.throws(() => registry.conflict(fact.id, { ...input, expectedRevision: 1, reason: "Test" }), /changed/);
  const conflict = registry.conflict(fact.id, { ...input, expectedRevision: 2, reason: "Test conflicting interpretation" });
  assert.throws(() => registry.resolve(fact.id, { ...review, conflictId: conflict.id, decision: "reject" }), /changed/);
  registry.resolve(fact.id, { ...review, expectedRevision: 2, conflictId: conflict.id, decision: "reject" });
  assert.equal(registry.get(fact.id).revisions.length, 2);
  assert.equal(registry.get(fact.id).conflicts[0].status, "REJECTED");
  assert.ok(registry.render(`{{fact:${fact.id}}}`).content.includes(statement));
});

test("quote mismatch, changed source, missing source and source traversal fail closed", (t) => {
  const { folder, registry, input, review, propose } = setup(t);
  assert.throws(() => registry.propose({ ...input, sources: [{ ...input.sources[0], quote: "Around 4:30" }] }), /exact quote/);
  assert.throws(() => registry.propose({ ...input, sources: [{ ...input.sources[0], path: "../outside.txt" }] }), /relative path/);
  const fact = propose();
  writeFileSync(join(folder, "sms.txt"), "Changed original");
  assert.throws(() => registry.verify(fact.id, review), /Source changed/);
  assert.equal(registry.check().issues[0].type, "SOURCE_CHANGED_OR_MISSING");
  rmSync(join(folder, "sms.txt"));
  assert.throws(() => registry.verify(fact.id, review), /ENOENT/);
});

test("binary evidence is fingerprinted and explicitly records that quote checking is manual", (t) => {
  const { folder, registry, input } = setup(t);
  writeFileSync(join(folder, "clip.mp4"), Buffer.from([0, 1, 2, 3]));
  const fact = registry.propose({ ...input, sources: [{ ...input.sources[0], path: "clip.mp4", locator: "00:04:37" }] });
  assert.equal(fact.revisions[0].sources[0].quoteChecked, false);
  assert.match(fact.revisions[0].sources[0].sha256, /^[a-f0-9]{64}$/);
});

test("exported exact blocks detect quiet paraphrasing, broken markers and unknown references", (t) => {
  const { folder, registry, verify } = setup(t);
  const fact = verify();
  writeFileSync(join(folder, "template.md"), `{{fact:${fact.id}}}`);
  registry.export("template.md", "output.md");
  assert.throws(() => registry.export("template.md", "exports/../.case-forge/hidden.md"), /relative path/);
  assert.throws(() => registry.export("template.md", "exports/output.txt"), /new .md/);
  assert.equal(registry.check().ok, true);
  const snapshot = readFileSync(join(folder, "output.md"), "utf8");
  writeFileSync(join(folder, "output.md"), snapshot.replace("4:37", "around 4:30"));
  assert.ok(registry.check().issues.some((i) => i.type === "LOCK_DRIFT"));
  writeFileSync(join(folder, "output.md"), snapshot.replace("<!-- /case-forge:fact -->", ""));
  assert.ok(registry.check().issues.some((i) => i.type === "MALFORMED_LOCK"));
  assert.throws(() => registry.render("{{fact:FACT-99999}}"), /not found/);
  assert.throws(() => registry.render("{{fact:FACT-00001@999}}"), /not a verified/);
  assert.throws(() => registry.render("{{fact:bad}}"), /Invalid fact reference/);
  assert.throws(() => registry.render("{{fact:FACT-00001"), /Malformed/);
  assert.throws(() => registry.render(snapshot), /reference templates/);
  writeFileSync(join(folder, "output.md"), "Collection around 4:30. All markers removed.");
  assert.ok(registry.check().issues.some((i) => i.type === "EXPORT_CHANGED"));
  rmSync(join(folder, "output.md"));
  assert.ok(registry.check().issues.some((i) => i.type === "EXPORT_MISSING_OR_UNREADABLE"));
});

test("registry edits are detected before reading, changing or rendering facts", (t) => {
  const { folder, registry, verify } = setup(t);
  verify();
  const path = join(folder, ".case-forge/facts/registry.json");
  writeFileSync(path, readFileSync(path, "utf8").replace("4:37", "4:30"));
  assert.throws(() => registry.list(), /integrity check failed/);
  assert.throws(() => registry.render("{{fact:FACT-00001}}"), /integrity check failed/);
});

test("read-only operations create no storage; IDs survive restart and failed operations", (t) => {
  const { folder, registry, input, review } = setup(t);
  assert.deepEqual(registry.list(), []);
  assert.equal(registry.check().ok, true);
  assert.deepEqual(readdirSync(folder), ["sms.txt"]);
  registry.propose(input);
  const restarted = new FactRegistry(folder);
  assert.equal(restarted.propose(input).id, "FACT-00002");
  assert.throws(() => restarted.verify("FACT-00001", { ...review, reviewer: "" }), /reviewer's name/);
  assert.equal(restarted.get("FACT-00001").revisions.length, 1);
});

test("cross-process write lock refuses concurrent mutation", (t) => {
  const { folder, registry, input, propose } = setup(t);
  propose();
  const lock = join(folder, ".case-forge/facts/write.lock");
  mkdirSync(lock);
  assert.throws(() => registry.propose(input), /holds the write lock/);
  assert.equal(registry.list().length, 1);
  rmSync(lock, { recursive: true });
  assert.equal(registry.propose(input).id, "FACT-00002");
});

test("symlinked registry storage, source files and export targets are refused", (t) => {
  const { folder, registry, input, verify } = setup(t);
  const outside = mkdtempSync(join(tmpdir(), "case-forge-facts-outside-"));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  writeFileSync(join(outside, "secret.txt"), quote);
  symlinkSync(join(outside, "secret.txt"), join(folder, "linked.txt"));
  assert.throws(() => registry.propose({ ...input, sources: [{ ...input.sources[0], path: "linked.txt" }] }), /link/);
  verify();
  writeFileSync(join(folder, "template.md"), "{{fact:FACT-00001}}");
  symlinkSync(outside, join(folder, "exports"));
  assert.throws(() => registry.export("template.md", "exports/result.md"), /link/);
  const second = join(folder, "second"); mkdirSync(second);
  symlinkSync(outside, join(second, ".case-forge"));
  assert.throws(() => new FactRegistry(second).list(), /link/);
  assert.deepEqual(readdirSync(outside), ["secret.txt"]);
});

test("accepting one conflict leaves other conflicts open; reviewed current revision is required", (t) => {
  const { registry, input, review, verify } = setup(t);
  const fact = verify();
  const a = registry.conflict(fact.id, { ...input, expectedRevision: 2, reason: "First correction" });
  const b = registry.conflict(fact.id, { ...input, expectedRevision: 2, reason: "Second correction" });
  registry.resolve(fact.id, { ...review, expectedRevision: 2, conflictId: a.id, decision: "accept" });
  assert.equal(registry.list()[0].openConflicts, 1);
  assert.throws(() => registry.render(`{{fact:${fact.id}}}`), /unresolved conflict/);
  assert.throws(() => registry.resolve(fact.id, { ...review, expectedRevision: 2, conflictId: b.id, decision: "accept" }), /changed/);
});
