import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Calendar, validCalendarDate } from "../lib/calendar.js";
import { AppError } from "../lib/errors.js";

function fixture(t, options = {}) { const root = mkdtempSync(join(tmpdir(), "caseforge-calendar-")); t.after(() => rmSync(root, { recursive: true, force: true })); return { root, calendar: new Calendar(root, options) }; }
const entry = (overrides = {}) => ({ id: randomUUID(), expectedRevision: 0, title: "Fictional case review", date: "2026-09-25", details: "Bring the reviewed documents.", status: "active", ...overrides });

test("manual calendar events persist, use optimistic revisions and archive without deleting history", t => {
  const { root, calendar } = fixture(t); const input = entry(), saved = calendar.save(input);
  assert.equal(saved.id, input.id); assert.equal(saved.revision, 1); assert.equal(saved.editable, true); assert.equal(saved.allDay, true);
  assert.equal(new Calendar(root).get(input.id).title, input.title);
  const changed = calendar.save({ ...input, expectedRevision: 1, title: "Review with adviser" }); assert.equal(changed.revision, 2);
  assert.throws(() => calendar.save({ ...input, expectedRevision: 1, title: "Stale overwrite" }), error => error.status === 409);
  assert.equal(calendar.get(input.id).title, "Review with adviser");
  const archived = calendar.save({ ...input, expectedRevision: 2, title: changed.title, status: "archived" }); assert.equal(archived.syncable, false);
  const state = JSON.parse(readFileSync(join(root, ".case-forge/calendar/registry.json"), "utf8")); assert.equal(state.entries[input.id].revisions.length, 3);
  assert.equal(state.entries[input.id].revisions[0].content.title, input.title);
  assert.equal(calendar.save({ ...input, expectedRevision: 3 }).status, "active");
});

test("calendar rejects invalid dates and malformed saves before persisting them", t => {
  const { root, calendar } = fixture(t);
  for (const date of ["2026-02-29", "2026-04-31", "2026-13-01", "2026-1-1", "0000-01-01", "2026-09-25T00:00:00Z", ""]) {
    assert.equal(validCalendarDate(date), false); assert.throws(() => calendar.save(entry({ date })), /valid calendar date/);
  }
  assert.equal(validCalendarDate("2024-02-29"), true);
  for (const values of [{ id: "../../bad" }, { expectedRevision: -1 }, { expectedRevision: 0.5 }, { title: " " }, { details: "x".repeat(3001) }, { status: "deleted" }]) assert.throws(() => calendar.save(entry(values)));
  assert.equal(existsSync(join(root, ".case-forge/calendar/registry.json")), false);
  assert.throws(() => calendar.get("absent"), error => error.status === 404);
});

test("read-only calendar can list but cannot create local storage", t => {
  const { root, calendar } = fixture(t, { assertWritable() { throw new AppError("Read-only case", 403); } });
  assert.deepEqual(calendar.list(), []); assert.throws(() => calendar.save(entry()), error => error.status === 403);
  assert.equal(existsSync(join(root, ".case-forge")), false);
});

test("aggregation preserves source references and never marks proposed or changed tasks confirmed", t => {
  const task = { id: randomUUID(), title: "Review records", status: "todo", dueDate: "2026-09-22", deadlineStatus: "confirmed", effectiveDeadlineStatus: "confirmed", sourceState: "current", timeZone: "Australia/Brisbane", assignee: "Case owner", revision: 2 };
  const tasks = [task, { ...task, id: randomUUID(), deadlineStatus: "proposed", effectiveDeadlineStatus: "proposed" }, { ...task, id: randomUUID(), sourceState: "changed", effectiveDeadlineStatus: "review_required" }, { ...task, id: randomUUID(), sourceState: "missing" }, { ...task, id: randomUUID(), status: "done" }, { ...task, id: randomUUID(), status: "cancelled" }, { ...task, id: randomUUID(), dueDate: "2026-02-31" }, { ...task, id: randomUUID(), deadlineStatus: "none", dueDate: "" }];
  const { calendar } = fixture(t, { getTasks: () => ({ entries: tasks }), getTimeline: () => [{ eventId: "EVT-01", title: "Fictional meeting", date: "2026-09-21", reference: "events/meeting.md" }, { eventId: "BAD", title: "Bad date", date: "2026-02-31" }] });
  calendar.save(entry()); const events = calendar.list(); assert.equal(events.length, 8);
  const confirmed = events.find(e => e.id === `task:${task.id}`); assert.equal(confirmed.syncable, true); assert.deepEqual(confirmed.source, { kind: "task", id: task.id });
  for (const source of tasks.slice(1, 6)) assert.equal(events.find(e => e.id === `task:${source.id}`).syncable, false);
  assert.equal(events.find(e => e.id === `task:${tasks[1].id}`).dateState, "proposed");
  assert.equal(events.find(e => e.id === `task:${tasks[2].id}`).dateState, "review_required");
  assert.deepEqual(events[0].source, { kind: "note", id: "events/meeting.md" }); assert.equal(events[0].editable, false);
  assert.throws(() => calendar.save(entry({ id: confirmed.id })), error => error.status === 409);
});

test("damaged registry and concurrent lock preserve existing calendar data", t => {
  const { root, calendar } = fixture(t); const input = entry(); calendar.save(input);
  const path = join(root, ".case-forge/calendar/registry.json"), original = readFileSync(path, "utf8"), lock = join(root, ".case-forge/calendar/write.lock");
  mkdirSync(lock); assert.throws(() => calendar.save({ ...input, expectedRevision: 1 }), /save is in progress/); assert.equal(readFileSync(path, "utf8"), original); rmSync(lock, { recursive: true });
  writeFileSync(path, "{broken"); assert.throws(() => calendar.save(entry()), /storage is damaged/); assert.equal(readFileSync(path, "utf8"), "{broken");
  writeFileSync(path, JSON.stringify({ schemaVersion: 1, entries: { bad: {} } })); assert.throws(() => calendar.list(), /storage is damaged/);
});
