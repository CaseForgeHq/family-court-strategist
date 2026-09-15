import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Journal, journalTargets } from "../lib/journal.js";
import { buildCaseModel } from "../lib/vault.js";
import { createServer } from "../server.js";

const content = (extra = {}) => ({ title: "Afternoon handover", happened: "I arrived at the meeting place.", words: 'Alex said, approximately, "I am here."', reflection: "PRIVATE REFLECTION SENTINEL", occurredDate: "2026-09-15", occurredTime: "16:37", precision: "approximate", timeZone: "Australia/Sydney", links: [], ...extra });
function setup(t) {
  const root = mkdtempSync(join(tmpdir(), "case-journal-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, journal: new Journal(root), input: { id: randomUUID(), expectedRevision: 0, content: content() } };
}

test("reading an empty journal creates no storage; saves stay out of case and summary data", (t) => {
  const { root, journal, input } = setup(t);
  assert.deepEqual(journal.list(), []);
  assert.deepEqual(readdirSync(root), []);
  const model = buildCaseModel(root);
  const saved = journal.save(input);
  assert.equal(saved.status, "PERSONAL_ACCOUNT");
  assert.equal(saved.revisions[0].content.occurredTime, "16:37");
  assert.ok(Date.parse(saved.recordedAt));
  assert.equal(saved.recordedAt, saved.revisions[0].savedAt);
  assert.equal(journal.get(input.id).revisions[0].content.reflection, "PRIVATE REFLECTION SENTINEL");
  assert.doesNotMatch(JSON.stringify(journal.list()), /PRIVATE REFLECTION|I arrived|Alex said/);
  assert.deepEqual(buildCaseModel(root), model);
  assert.deepEqual(journalTargets(root), []);
});

test("corrections preserve history and recording time, reject stale changes, and retry idempotently", (t) => {
  const { root, journal, input } = setup(t);
  const first = journal.save(input);
  assert.deepEqual(journal.save(input), first);
  const correction = { ...input, expectedRevision: 1, reason: "Checked my recollection", content: content({ occurredTime: "16:42" }) };
  const second = journal.save(correction);
  assert.equal(second.recordedAt, first.recordedAt);
  assert.equal(second.revisions.length, 2);
  assert.equal(second.revisions[0].content.occurredTime, "16:37");
  assert.equal(second.revisions[1].content.occurredTime, "16:42");
  assert.deepEqual(journal.save(correction), second);
  assert.throws(() => journal.save({ ...correction, content: content({ occurredTime: "17:00" }) }), /newer version/);
  assert.throws(() => journal.save({ ...correction, expectedRevision: 2, reason: "" }), /Correction reason/);
  assert.equal(new Journal(root).get(input.id).revisions.length, 2);
});

test("event timing remains explicit, unknown and reflection-only accounts are supported", (t) => {
  const { journal } = setup(t);
  const save = (c) => journal.save({ id: randomUUID(), expectedRevision: 0, content: content(c) });
  for (const c of [{ occurredDate: "2026-02-30" }, { occurredDate: "0000-01-01" }, { occurredTime: "25:00" }, { precision: "unknown" }, { timeZone: "fake-zone" }, { occurredDate: "" }, { title: "" }, { links: ["note:../escape.md"] }, { happened: "", words: "", reflection: "" }]) {
    assert.throws(() => save(c));
  }
  const saved = save({ happened: "", words: "", occurredDate: "", occurredTime: "", precision: "unknown" });
  assert.equal(saved.revisions[0].content.occurredDate, "");
  const dateOnly = save({ occurredTime: "", precision: "exact" });
  assert.equal(dateOnly.revisions[0].content.occurredTime, "");
});

test("links resolve existing records, preserve missing targets and never promote accounts", (t) => {
  const { root, journal, input } = setup(t);
  writeFileSync(join(root, "event.md"), "---\ntype: event\nevent_id: EVT-1\ndate: 2026-09-15\n---\n# Meeting\n");
  input.content.links = ["note:event.md"];
  const model = buildCaseModel(root);
  const first = journal.save(input);
  assert.equal(first.revisions[0].content.links[0].title, "Meeting");
  assert.equal(first.revisions[0].content.links[0].available, true);
  assert.deepEqual(buildCaseModel(root), model);
  rmSync(join(root, "event.md"));
  assert.equal(journal.get(input.id).revisions[0].content.links[0].available, false);
  const edited = journal.save({ ...input, expectedRevision: 1, reason: "Corrected recollection" });
  assert.equal(edited.revisions[1].content.links[0].id, "note:event.md");
});

test("read-only, symlink, lock and malformed storage failures do not overwrite journal data", (t) => {
  const { root, journal, input } = setup(t);
  assert.throws(() => new Journal(root, { assertWritable() { throw new Error("read-only"); } }).save(input), /read-only/);
  assert.deepEqual(readdirSync(root), []);
  journal.save(input);
  const path = join(root, ".case-forge/journal/registry.json");
  const before = readFileSync(path, "utf8");
  mkdirSync(join(root, ".case-forge/journal/write.lock"));
  assert.throws(() => journal.save(input), /save is in progress/);
  assert.equal(readFileSync(path, "utf8"), before);
  rmSync(join(root, ".case-forge/journal/write.lock"), { recursive: true });
  writeFileSync(path, '{"schemaVersion":88,"entries":{}}');
  assert.throws(() => journal.save(input), /storage could not be read/);
  rmSync(path);
  const external = join(root, "external.json");
  writeFileSync(external, before);
  symlinkSync(external, path);
  assert.throws(() => journal.save(input), /link/);
  assert.equal(readFileSync(external, "utf8"), before);
});

test("journal API enforces case/token/origin/write boundaries and excludes private data from chronology", async (t) => {
  const { root, input } = setup(t);
  let writable = true, activeRoot = root;
  const server = createServer(() => activeRoot, { getAccess: () => ({ canWrite: writable }) });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const session = await (await fetch(`${base}/api/session`)).json();
  const headers = { "content-type": "application/json", "x-case-id": session.caseKey, "x-strategist-token": session.token };
  const post = (body = input, overrides = {}) => fetch(`${base}/api/journal`, { method: "POST", headers: { ...headers, ...overrides }, body: JSON.stringify(body) });
  assert.equal((await post(input, { "x-strategist-token": "bad" })).status, 403);
  assert.equal((await post(input, { "x-case-id": "bad" })).status, 409);
  assert.equal((await post(input, { origin: "https://example.com" })).status, 403);
  assert.equal((await post()).status, 200);
  writable = false;
  assert.equal((await post()).status, 403);
  const detail = await fetch(`${base}/api/journal/${input.id}`, { headers });
  assert.equal(detail.status, 200);
  assert.match(JSON.stringify(await detail.json()), /PRIVATE REFLECTION/);
  assert.equal((await fetch(`${base}/api/journal/${input.id}`)).status, 409);
  assert.equal((await fetch(`${base}/.case-forge/journal/registry.json`)).status, 404);
  writable = true;
  const chronology = await fetch(`${base}/api/exports/chronology`, { method: "POST", headers, body: "{}" });
  assert.doesNotMatch(await chronology.text(), /PRIVATE REFLECTION|Afternoon handover/);
  assert.deepEqual((await (await fetch(`${base}/api/facts`, { headers })).json()).facts, []);
  activeRoot = mkdtempSync(join(tmpdir(), "journal-other-case-"));
  t.after(() => rmSync(activeRoot, { recursive: true, force: true }));
  assert.equal((await post()).status, 409);
  assert.deepEqual(readdirSync(activeRoot), []);
});
