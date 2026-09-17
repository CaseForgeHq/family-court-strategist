import { mkdirSync, rmdirSync } from "node:fs";
import { caseRoot, readJson, safePath, writeJson } from "./files.js";
import { AppError } from "./errors.js";

const STORE = ".case-forge/calendar/registry.json", LOCK = ".case-forge/calendar/write.lock";
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export function validCalendarDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !value.startsWith("0000") &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
function text(value, label, max, required = false) {
  if (typeof value !== "string" || value.length > max || value.includes("\0") || required && !value.trim()) throw new AppError(`${label}: enter ${required ? "1–" : "up to "}${max} characters.`);
  return value.trim();
}
function content(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new AppError("Enter a calendar event.");
  const value = { title: text(input.title, "Title", 160, true), date: input.date, details: text(input.details ?? "", "Notes", 3000), status: input.status ?? "active" };
  if (!validCalendarDate(value.date)) throw new AppError("Choose a valid calendar date.");
  if (!["active", "archived"].includes(value.status)) throw new AppError("Choose an active or archived event.");
  return value;
}
function storedValid(entry, id) {
  if (!entry || entry.id !== id || !UUID.test(id) || !Array.isArray(entry.revisions) || !entry.revisions.length) return false;
  return entry.revisions.every((r, i) => {
    if (!r || r.revision !== i + 1 || typeof r.savedAt !== "string" || !Number.isFinite(Date.parse(r.savedAt))) return false;
    try { content(r.content); return true; } catch { return false; }
  });
}
function manual(entry) {
  const latest = entry.revisions.at(-1);
  return { id: entry.id, ...latest.content, revision: latest.revision, createdAt: entry.createdAt, updatedAt: latest.savedAt,
    kind: "manual", allDay: true, dateState: "personal", editable: true, syncable: latest.content.status === "active", source: null };
}

/** Calendar dates never calculate a legal deadline or copy journal text. */
export class Calendar {
  constructor(root, { assertWritable = () => {}, getTasks = () => [], getTimeline = () => [], now = () => new Date() } = {}) {
    this.root = caseRoot(root); this.assertWritable = assertWritable; this.getTasks = getTasks; this.getTimeline = getTimeline; this.now = now;
  }
  read() {
    let state;
    try { state = readJson(this.root, STORE); }
    catch (error) {
      if (error.code === "ENOENT") return { schemaVersion: 1, entries: {} };
      if (error instanceof SyntaxError) throw new AppError("Calendar storage is damaged. Restore a known backup before editing.", 409);
      throw error;
    }
    if (!state || state.schemaVersion !== 1 || !state.entries || typeof state.entries !== "object" || Array.isArray(state.entries) || Object.entries(state.entries).some(([id, entry]) => !storedValid(entry, id))) {
      throw new AppError("Calendar storage is damaged. Restore a known backup before editing.", 409);
    }
    return state;
  }
  list() {
    const taskResult = this.getTasks(), timelineResult = this.getTimeline();
    const tasks = Array.isArray(taskResult) ? taskResult : taskResult?.entries || [];
    const timeline = Array.isArray(timelineResult) ? timelineResult : timelineResult?.timeline || [];
    const events = Object.values(this.read().entries).map(manual);
    for (const task of tasks) {
      if (!task?.id || !validCalendarDate(task.dueDate) || task.deadlineStatus === "none") continue;
      const dateState = ["missing", "changed"].includes(task.sourceState) || task.effectiveDeadlineStatus === "review_required" || task.bucket === "review" && task.deadlineStatus === "confirmed" ? "review_required" :
        task.deadlineStatus === "confirmed" && [undefined, "confirmed"].includes(task.effectiveDeadlineStatus) ? "confirmed" : "proposed";
      const status = task.status === "done" ? "completed" : task.status === "cancelled" ? "cancelled" : "active";
      events.push({ id: `task:${task.id}`, title: String(task.title || "Untitled task"), date: task.dueDate,
        details: [task.assignee && `Responsible: ${task.assignee}.`, dateState === "confirmed" ? "Date confirmed by the user." : "Date needs review; this is not a confirmed deadline.", task.timeZone && `Source time zone: ${task.timeZone}.`, "All-day reference; check any required cut-off time separately."].filter(Boolean).join(" "),
        kind: "task", allDay: true, status, dateState, editable: false, syncable: status === "active" && dateState === "confirmed", source: { kind: "task", id: task.id }, revision: task.revision, timeZone: task.timeZone || "" });
    }
    for (const item of timeline) {
      if (!item?.eventId || !validCalendarDate(item.date)) continue;
      events.push({ id: `timeline:${item.eventId}`, title: String(item.title || "Recorded event"), date: item.date, details: `Case timeline record ${item.eventId}.`,
        kind: "timeline", allDay: true, status: "active", dateState: "recorded", editable: false, syncable: true,
        source: { kind: "note", id: item.reference || item.file || item.eventId } });
    }
    return events.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  }
  get(id) {
    if (typeof id !== "string") throw new AppError("Calendar event not found.", 404);
    const event = this.list().find(item => item.id === id);
    if (!event) throw new AppError("Calendar event not found.", 404);
    return event;
  }
  save(input) {
    this.assertWritable(this.root);
    if (!input || !UUID.test(input.id) || !Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) throw new AppError("Reopen the calendar event before saving.", 409);
    const value = content(input), lock = safePath(this.root, LOCK, true);
    try { mkdirSync(lock, { mode: 0o700 }); }
    catch (error) { if (error.code === "EEXIST") throw new AppError("Another calendar save is in progress. Try again shortly.", 409); throw error; }
    try {
      const state = this.read(), existing = state.entries[input.id], revision = existing?.revisions.at(-1)?.revision || 0;
      if (revision !== input.expectedRevision) throw new AppError("This event has a newer saved version. Your draft is still here; reopen the event before saving again.", 409);
      const savedAt = this.now().toISOString(), entry = existing || { id: input.id, createdAt: savedAt, revisions: [] };
      entry.revisions.push({ revision: revision + 1, savedAt, content: value }); state.entries[input.id] = entry;
      this.assertWritable(this.root); writeJson(this.root, STORE, state);
      return manual(entry);
    } finally { rmdirSync(lock); }
  }
}
