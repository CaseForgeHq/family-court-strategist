import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, readdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Tasks, taskAttention, taskTargets } from "../lib/tasks.js";
import { Journal } from "../lib/journal.js";
import { buildCaseModel } from "../lib/vault.js";
import { createServer } from "../server.js";

const content = (extra = {}) => ({ title: "Provide school records", kind: "task", assignee: "Applicant", details: "Prepare the requested copies.", status: "todo", completionNote: "", sourceId: "", sourceLocator: "", dueDate: "", deadlineStatus: "none", dateOrigin: "personal", deadlineBasis: "", timeZone: "Australia/Sydney", reminderDate: "", ...extra });
const request = (extra = {}) => ({ id: randomUUID(), requestId: randomUUID(), expectedRevision: 0, actor: "Test user", reason: "", content: content(), ...extra });
const revise = (input, extra = {}) => ({ ...input, expectedRevision: input.expectedRevision + 1, requestId: randomUUID(), reason: "Reviewed the task", ...extra });
function setup(t) {
  const root = mkdtempSync(join(tmpdir(), "tasks-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, tasks: new Tasks(root, { now: () => new Date("2026-09-15T00:00:00Z") }) };
}

test("reading tasks creates no files; personal tasks stay outside evidence, facts and chronology", (t) => {
  const { root, tasks } = setup(t);
  assert.equal(tasks.list().entries.length, 0); assert.deepEqual(readdirSync(root), []);
  const before = buildCaseModel(root), input = request();
  const saved = tasks.save(input);
  assert.equal(saved.bucket, "undated");
  assert.equal(saved.revisions[0].content.confirmedAt, null);
  assert.equal(tasks.list().counts.undated, 1);
  assert.deepEqual(buildCaseModel(root), before);
  assert.deepEqual(new Tasks(root).get(input.id).revisions, saved.revisions);
});

test("deadline confirmation requires an explicit check and changing its basis requires another review", (t) => {
  const { tasks } = setup(t);
  const input = request({ content: content({ dueDate: "2026-09-14", deadlineStatus: "proposed", dateOrigin: "suggested" }) });
  tasks.save(input);
  assert.equal(tasks.list().counts.review, 1); assert.equal(tasks.list().counts.overdue, 0);
  const confirmed = revise(input, { content: { ...input.content, deadlineStatus: "confirmed", deadlineBasis: "Checked the date in my planning notes", reminderDate: "2026-09-13" } });
  assert.throws(() => tasks.save(confirmed), /tick the deadline confirmation/);
  confirmed.confirmDeadline = true;
  const saved = tasks.save(confirmed);
  assert.equal(saved.bucket, "overdue"); assert.equal(saved.reminderDue, true);
  assert.equal(saved.revisions[1].content.confirmedBy, "Test user");
  const changed = revise(confirmed, { confirmDeadline: false, content: { ...confirmed.content, dueDate: "2026-09-22" } });
  assert.throws(() => tasks.save(changed), /tick the deadline confirmation/);
  const proposed = { ...changed, content: { ...changed.content, deadlineStatus: "proposed", reminderDate: "" } };
  assert.equal(tasks.save(proposed).bucket, "review");
  assert.equal(tasks.get(input.id).revisions.at(-1).content.confirmedAt, null);
});

test("source-linked obligations require review and source changes or loss invalidate active queues", (t) => {
  const { root, tasks } = setup(t);
  writeFileSync(join(root, "order.md"), "---\ntype: legal\n---\n# Order\nParagraph 4: provide copies.\n");
  const input = request({ content: content({ kind: "obligation", sourceId: "note:order.md", sourceLocator: "Paragraph 4", dueDate: "2026-09-22", deadlineStatus: "confirmed", dateOrigin: "source", deadlineBasis: "Read paragraph 4", reminderDate: "2026-09-15" }), confirmDeadline: true });
  input.content.sourceDigest = taskTargets(root)[0].digest;
  assert.throws(() => tasks.save(input), /obligation review box/);
  input.content.sourceDigest = taskTargets(root)[0].digest;
  input.reviewObligation = true;
  const saved = tasks.save(input);
  assert.equal(saved.sourceState, "current"); assert.equal(saved.bucket, "upcoming");
  const oldDigest = saved.revisions[0].content.source.digest;
  writeFileSync(join(root, "order.md"), "---\ntype: legal\n---\n# Order\nParagraph 4 has been amended.\n");
  assert.equal(tasks.list().counts.review, 1); assert.equal(tasks.list().counts.reminders, 0);
  assert.equal(tasks.get(input.id).sourceState, "changed");
  const changed = revise(input, { reviewObligation: false, confirmDeadline: false });
  assert.throws(() => tasks.save(changed), /source changed since it was loaded/);
  changed.content = { ...changed.content, sourceDigest: taskTargets(root)[0].digest };
  assert.throws(() => tasks.save(changed), /obligation review box/);
  changed.reviewObligation = true;
  assert.throws(() => tasks.save(changed), /tick the deadline confirmation/);
  changed.confirmDeadline = true;
  const reviewed = tasks.save(changed);
  assert.notEqual(reviewed.revisions[1].content.source.digest, oldDigest);
  assert.equal(reviewed.revisions[0].content.source.digest, oldDigest);
  rmSync(join(root, "order.md"));
  assert.equal(tasks.get(input.id).sourceState, "missing"); assert.equal(tasks.list().counts.review, 1);
  assert.throws(() => tasks.save(revise(changed, { content: { ...changed.content, dueDate: "2026-09-25" } })), /available source/);
});

test("dates are validated and categorised using each deadline's calendar timezone, including DST boundaries", (t) => {
  const { tasks } = setup(t);
  const now = new Date("2026-10-03T15:30:00Z");
  const base = content({ dueDate: "2026-10-04", deadlineStatus: "confirmed", timeZone: "Australia/Sydney", reminderDate: "2026-10-04" });
  assert.deepEqual(taskAttention(base, now), { bucket: "today", reminderDue: true });
  assert.equal(taskAttention({ ...base, timeZone: "America/Los_Angeles" }, now).bucket, "upcoming");
  assert.equal(taskAttention({ ...base, dueDate: "2026-10-03" }, now).bucket, "overdue");
  for (const c of [{ dueDate: "2026-02-30", deadlineStatus: "proposed" }, { dueDate: "0000-01-01", deadlineStatus: "proposed" }, { dueDate: "2026-09-22" }, { timeZone: "fake-zone" }, { dueDate: "2026-09-22", deadlineStatus: "proposed", reminderDate: "2026-09-20" }, { dueDate: "2026-09-22", deadlineStatus: "confirmed", reminderDate: "2026-09-23", deadlineBasis: "Checked" }, { sourceId: "note:../../secret.md" }]) {
    assert.throws(() => tasks.save(request({ content: content(c), confirmDeadline: true })));
  }
});

test("completion, reopening and cancellation preserve notes and exclude closed tasks from reminders", (t) => {
  const { tasks } = setup(t);
  const input = request({ content: content({ dueDate: "2026-09-15", deadlineStatus: "confirmed", deadlineBasis: "My planning date", reminderDate: "2026-09-14" }), confirmDeadline: true });
  tasks.save(input);
  const done = revise(input, { content: { ...input.content, status: "done" } });
  assert.throws(() => tasks.save(done), /completion note/);
  done.content.completionNote = "Sent the copies; email saved in the case folder.";
  const saved = tasks.save(done);
  assert.equal(saved.bucket, "done"); assert.equal(saved.reminderDue, false);
  assert.equal(saved.revisions.at(-1).content.completedAt, "2026-09-15T00:00:00.000Z");
  const reopen = revise(done, { content: { ...done.content, status: "in_progress", completionNote: "" } });
  assert.equal(tasks.save(reopen).bucket, "today");
  assert.equal(tasks.get(input.id).revisions[1].content.completionNote, done.content.completionNote);
  const cancel = revise(reopen, { content: { ...reopen.content, status: "cancelled" }, reason: "Superseded by amended request" });
  assert.equal(tasks.save(cancel).bucket, "cancelled");
  assert.equal(tasks.list().counts.reminders, 0);
});

test("identical retries are idempotent; stale edits and reused operation identifiers cannot overwrite tasks", (t) => {
  const { tasks } = setup(t);
  const input = request(), saved = tasks.save(input);
  assert.deepEqual(tasks.save(input), saved);
  assert.throws(() => tasks.save({ ...input, content: content({ title: "Different task" }) }), /different content/);
  const edit = revise(input, { content: content({ status: "in_progress" }) });
  tasks.save(edit);
  assert.throws(() => tasks.save({ ...edit, requestId: randomUUID(), content: content({ title: "Stale edit" }) }), /newer version/);
  assert.equal(tasks.save(input).revisions.length, 2);
});

test("journal references carry only title and revision digest, cannot establish obligations, and detect corrections", (t) => {
  const { root } = setup(t), journal = new Journal(root);
  const j = { id: randomUUID(), expectedRevision: 0, content: { title: "Private meeting", happened: "ACCOUNT SENTINEL", words: "", reflection: "REFLECTION SENTINEL", occurredDate: "", occurredTime: "", precision: "unknown", timeZone: "UTC", links: [] } };
  journal.save(j);
  const targets = () => taskTargets(root, [], journal.list());
  assert.doesNotMatch(JSON.stringify(targets()), /ACCOUNT SENTINEL|REFLECTION SENTINEL/);
  const tasks = new Tasks(root, { getTargets: targets });
  const input = request({ content: content({ sourceId: `journal:${j.id}`, sourceDigest: targets()[0].digest }) });
  const saved = tasks.save(input);
  assert.doesNotMatch(JSON.stringify(saved), /ACCOUNT SENTINEL|REFLECTION SENTINEL/);
  assert.throws(() => tasks.save(request({ content: { ...input.content, kind: "obligation", sourceLocator: "Recollection" }, reviewObligation: true })), /journal recollection/);
  journal.save({ ...j, expectedRevision: 1, reason: "Added context", content: { ...j.content, happened: "Updated account" } });
  assert.equal(tasks.get(input.id).sourceState, "changed");
});

test("read-only, lock, symlink and corrupt-storage failures leave saved records intact", (t) => {
  const { root, tasks } = setup(t), input = request();
  assert.throws(() => new Tasks(root, { assertWritable() { throw new Error("read-only"); } }).save(input), /read-only/);
  assert.deepEqual(readdirSync(root), []);
  tasks.save(input);
  const file = join(root, ".case-forge/tasks/registry.json"), before = readFileSync(file, "utf8");
  mkdirSync(join(root, ".case-forge/tasks/write.lock"));
  assert.throws(() => tasks.save(input), /save is in progress/); assert.equal(readFileSync(file, "utf8"), before);
  rmSync(join(root, ".case-forge/tasks/write.lock"), { recursive: true });
  writeFileSync(file, '{broken');
  assert.throws(() => tasks.save(input), /storage is damaged/); assert.equal(readFileSync(file, "utf8"), '{broken');
  const damaged = JSON.parse(before); damaged.entries[input.id].revisions[0].content.timeZone = "invalid-zone";
  writeFileSync(file, JSON.stringify(damaged));
  assert.throws(() => tasks.save(input), /storage is damaged/);
  rmSync(file); const external = join(root, "outside.json"); writeFileSync(external, before); symlinkSync(external, file);
  assert.throws(() => tasks.save(input), /link/); assert.equal(readFileSync(external, "utf8"), before);
});

test("task APIs enforce write, origin, token and case boundaries without exposing journal bodies", async (t) => {
  const { root } = setup(t); let active = root, writable = true;
  new Journal(root).save({ id: randomUUID(), expectedRevision: 0, content: { title: "Journal title", happened: "PRIVATE ACCOUNT", words: "", reflection: "PRIVATE REFLECTION", occurredDate: "", occurredTime: "", precision: "unknown", timeZone: "UTC", links: [] } });
  const server = createServer(() => active, { getAccess: () => ({ canWrite: writable }) });
  await new Promise((r) => server.listen(0, "127.0.0.1", r)); t.after(() => new Promise((r) => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}`, session = await (await fetch(`${base}/api/session`)).json();
  const headers = { "content-type": "application/json", "x-case-id": session.caseKey, "x-strategist-token": session.token }, input = request();
  const post = (overrides = {}) => fetch(`${base}/api/tasks`, { method: "POST", headers: { ...headers, ...overrides }, body: JSON.stringify(input) });
  assert.equal((await post({ "x-strategist-token": "bad" })).status, 403);
  assert.equal((await post({ origin: "https://example.com" })).status, 403);
  assert.equal((await post({ "x-case-id": "bad" })).status, 409);
  assert.equal((await post()).status, 200);
  writable = false; assert.equal((await post()).status, 403);
  assert.equal((await fetch(`${base}/api/tasks/${input.id}`, { headers })).status, 200);
  assert.equal((await fetch(`${base}/api/tasks`)).status, 409);
  const normal = await (await fetch(`${base}/api/tasks/targets`, { headers })).json();
  assert.equal(normal.targets.some((s) => s.kind === "journal"), false);
  const journalTargets = await (await fetch(`${base}/api/tasks/journal-targets`, { headers })).text();
  assert.match(journalTargets, /Journal title/); assert.doesNotMatch(journalTargets, /PRIVATE ACCOUNT|PRIVATE REFLECTION/);
  assert.equal((await fetch(`${base}/.case-forge/tasks/registry.json`)).status, 404);
  active = mkdtempSync(join(tmpdir(), "other-tasks-case-")); t.after(() => rmSync(active, { recursive: true, force: true }));
  assert.equal((await post()).status, 409); assert.deepEqual(readdirSync(active), []);
  await server.closeWorkspace();
});
