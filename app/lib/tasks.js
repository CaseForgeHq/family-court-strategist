import { mkdirSync, rmdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { caseRoot, readJson, readLocal, safePath, writeJson } from "./files.js";
import { AppError } from "./errors.js";
import { journalTargets } from "./journal.js";

const STORE = ".case-forge/tasks/registry.json", LOCK = ".case-forge/tasks/write.lock";
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const hash = (value) => createHash("sha256").update(value).digest("hex");
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function text(value, label, max, required = false) {
  if (typeof value !== "string" || value.length > max || value.includes("\0") || (required && !value.trim())) throw new AppError(`${label}: enter ${required ? "1–" : "up to "}${max} characters.`);
  return value.trim();
}
function validDate(date) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && !date.startsWith("0000") && Number.isFinite(Date.parse(`${date}T00:00:00Z`)) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
}
function dayInZone(now, timeZone) {
  const parts = new Intl.DateTimeFormat("en", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  return ["year", "month", "day"].map((name) => parts.find((p) => p.type === name).value).join("-");
}
function storedContentValid(c) {
  if (!c || ["title", "assignee", "details", "completionNote", "dueDate", "timeZone", "deadlineBasis", "reminderDate"].some((k) => typeof c[k] !== "string") ||
    !c.title.trim() || !c.assignee.trim() || !["task", "obligation"].includes(c.kind) || !["todo", "in_progress", "done", "cancelled"].includes(c.status) ||
    !["none", "proposed", "confirmed"].includes(c.deadlineStatus) || !["personal", "source", "suggested"].includes(c.dateOrigin)) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: c.timeZone }); } catch { return false; }
  if (c.deadlineStatus === "none" ? c.dueDate || c.reminderDate : !validDate(c.dueDate)) return false;
  if (c.reminderDate && (c.deadlineStatus !== "confirmed" || !validDate(c.reminderDate) || c.reminderDate > c.dueDate)) return false;
  if (c.source !== null && (!c.source || typeof c.source.id !== "string" || typeof c.source.title !== "string" || typeof c.source.kind !== "string" ||
    typeof c.source.locator !== "string" || !/^[a-f0-9]{64}$/.test(c.source.digest))) return false;
  for (const [needed, date, actor] of [[c.deadlineStatus === "confirmed", c.confirmedAt, c.confirmedBy], [c.kind === "obligation", c.reviewedAt, c.reviewedBy]]) {
    if (needed && (typeof date !== "string" || !Number.isFinite(Date.parse(date)) || typeof actor !== "string" || !actor.trim())) return false;
  }
  if (c.kind === "obligation" && (!c.source || c.source.kind === "journal" || !c.source.locator)) return false;
  if (c.status === "done" && (!c.completionNote.trim() || typeof c.completedAt !== "string" || !Number.isFinite(Date.parse(c.completedAt)))) return false;
  return true;
}

// Reference snapshots include a digest, so a changed source cannot silently keep
// a deadline in the confirmed work queue. Journal bodies are never read here.
export function taskTargets(root, documents = [], journalEntries = []) {
  root = caseRoot(root);
  return [...journalTargets(root, documents).flatMap((target) => {
    try {
      const path = target.kind === "document" ? documents.find((d) => `document:${d.id}` === target.id)?.original : target.id.slice(5);
      if (!path) return [];
      return [{ ...target, digest: hash(readLocal(root, path)) }];
    } catch (error) { if (error.code === "ENOENT") return []; throw error; }
  }), ...journalEntries.map((e) => ({ id: `journal:${e.id}`, title: e.title, kind: "journal", digest: hash(JSON.stringify([e.id, e.revision])) }))];
}

function sourceState(content, targets) {
  if (!content.source) return "none";
  const current = targets.find((t) => t.id === content.source.id);
  return !current ? "missing" : current.digest !== content.source.digest ? "changed" : "current";
}
function effectiveDeadlineStatus(content, source) {
  return content.deadlineStatus === "confirmed" && ["changed", "missing"].includes(source) ? "review_required" : content.deadlineStatus;
}
export function taskAttention(content, now = new Date(), source = "current") {
  if (content.status === "done") return { bucket: "done", reminderDue: false };
  if (content.status === "cancelled") return { bucket: "cancelled", reminderDue: false };
  if (["missing", "changed"].includes(source) || content.deadlineStatus === "proposed") return { bucket: "review", reminderDue: false };
  if (content.deadlineStatus === "none") return { bucket: "undated", reminderDue: false };
  const today = dayInZone(now, content.timeZone);
  return { bucket: content.dueDate < today ? "overdue" : content.dueDate === today ? "today" : "upcoming",
    reminderDue: Boolean(content.reminderDate && content.reminderDate <= today) };
}

export class Tasks {
  constructor(root, { assertWritable = () => {}, getTargets, now = () => new Date() } = {}) {
    this.root = caseRoot(root); this.assertWritable = assertWritable;
    this.getTargets = getTargets || (() => taskTargets(this.root)); this.now = now;
  }
  read() {
    let state;
    try { state = readJson(this.root, STORE); }
    catch (error) {
      if (error.code === "ENOENT") return { schemaVersion: 1, entries: {} };
      if (error instanceof SyntaxError) throw new AppError("Task storage is damaged. Restore a known backup before editing.", 409);
      throw error;
    }
    if (!state || state.schemaVersion !== 1 || !state.entries || typeof state.entries !== "object" || Array.isArray(state.entries) ||
      Object.entries(state.entries).some(([id, e]) => !e || !UUID.test(id) || e.id !== id || !Array.isArray(e.revisions) || !e.revisions.length ||
        e.revisions.some((r, i) => !r || r.revision !== i + 1 || !storedContentValid(r.content) || typeof r.savedAt !== "string" || !Number.isFinite(Date.parse(r.savedAt)) || !UUID.test(r.requestId) || !/^[a-f0-9]{64}$/.test(r.requestHash)))) {
      throw new AppError("Task storage is damaged. Restore a known backup before editing.", 409);
    }
    return state;
  }
  list() {
    const targets = this.getTargets(), now = this.now();
    const entries = Object.values(this.read().entries).map((e) => {
      const latest = e.revisions.at(-1), c = latest.content, source = sourceState(c, targets);
      return { id: e.id, createdAt: e.createdAt, revision: latest.revision, title: c.title, kind: c.kind, assignee: c.assignee,
        status: c.status, dueDate: c.dueDate, deadlineStatus: c.deadlineStatus, effectiveDeadlineStatus: effectiveDeadlineStatus(c, source), timeZone: c.timeZone, sourceState: source,
        ...taskAttention(c, now, source) };
    });
    const order = ["review", "overdue", "today", "upcoming", "undated", "done", "cancelled"];
    entries.sort((a, b) => order.indexOf(a.bucket) - order.indexOf(b.bucket) || (a.dueDate || "9999").localeCompare(b.dueDate || "9999") || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
    const counts = Object.fromEntries(order.map((bucket) => [bucket, entries.filter((e) => e.bucket === bucket).length]));
    counts.reminders = entries.filter((e) => e.reminderDue).length;
    return { entries, counts, evaluatedAt: now.toISOString() };
  }
  get(id) {
    if (!UUID.test(id)) throw new AppError("Task not found.", 404);
    const e = this.read().entries[id];
    if (!e) throw new AppError("Task not found.", 404);
    const source = sourceState(e.revisions.at(-1).content, this.getTargets());
    return { ...e, sourceState: source, effectiveDeadlineStatus: effectiveDeadlineStatus(e.revisions.at(-1).content, source), ...taskAttention(e.revisions.at(-1).content, this.now(), source) };
  }
  content(input, previous, actor, request, now) {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new AppError("Enter a task.");
    const c = {};
    for (const [key, label, max, required] of [["title", "Task title", 160, true], ["assignee", "Person responsible", 160, true], ["details", "Task details", 3000],
      ["completionNote", "Completion note", 2000], ["dueDate", "Due date", 10], ["timeZone", "Time zone", 80, true], ["deadlineBasis", "Date basis", 1000], ["reminderDate", "Reminder date", 10]]) {
      c[key] = text(input[key] ?? "", label, max, required);
    }
    for (const [key, options] of [["kind", ["task", "obligation"]], ["status", ["todo", "in_progress", "done", "cancelled"]], ["deadlineStatus", ["none", "proposed", "confirmed"]], ["dateOrigin", ["personal", "source", "suggested"]]]) {
      if (!options.includes(input[key])) throw new AppError(`Choose a valid ${key}.`);
      c[key] = input[key];
    }
    try { new Intl.DateTimeFormat("en", { timeZone: c.timeZone }); } catch { throw new AppError("Use a valid time zone, such as Australia/Sydney."); }
    if (c.deadlineStatus === "none" ? c.dueDate || c.reminderDate : !validDate(c.dueDate)) throw new AppError("Enter a valid due date, or choose no date and clear the date and reminder fields.");
    if (c.reminderDate && (c.deadlineStatus !== "confirmed" || !validDate(c.reminderDate) || c.reminderDate > c.dueDate)) throw new AppError("An in-app reminder requires a confirmed deadline and a valid date on or before it.");
    const sourceId = text(input.sourceId ?? "", "Source reference", 1500);
    const locator = text(input.sourceLocator ?? "", "Source location", 500);
    const target = this.getTargets().find((t) => t.id === sourceId);
    if (sourceId && !target && previous?.source?.id !== sourceId) throw new AppError("That source is no longer available. Refresh the sources and try again.", 409);
    if (target && input.sourceDigest !== target.digest) throw new AppError("The source changed since it was loaded. Refresh the sources, review the record and confirm again before saving.", 409);
    c.source = sourceId ? { ...(target || previous.source), locator } : null;
    if (!sourceId && locator) throw new AppError("Choose a source for the source location.");
    if (c.kind === "obligation" && (!c.source || c.source.kind === "journal" || !locator)) throw new AppError("An obligation needs an existing case note or document and a page, paragraph or other source location. A journal recollection alone is not an obligation source.");
    if (c.dateOrigin === "source" && c.deadlineStatus !== "none" && (!c.source || c.source.kind === "journal" || !locator)) throw new AppError("A source-based date needs a case note or document and its location.");
    if (c.deadlineStatus === "confirmed" && !c.deadlineBasis) throw new AppError("Record how you checked this date, including any cut-off time you need to check separately.");
    const obligationBasis = (v) => [v?.kind, v?.title, v?.assignee, v?.details, v?.source];
    const dateBasis = (v) => [...obligationBasis(v), v?.dueDate, v?.timeZone, v?.dateOrigin, v?.deadlineBasis];
    const reviewObligation = c.kind === "obligation" && (!previous?.reviewedAt || !same(obligationBasis(c), obligationBasis(previous)));
    if (reviewObligation && (request.reviewObligation !== true || !target)) throw new AppError("Review the obligation against its available source and tick the obligation review box before saving.");
    c.reviewedAt = c.kind === "obligation" ? reviewObligation ? now : previous.reviewedAt : null;
    c.reviewedBy = c.kind === "obligation" ? reviewObligation ? actor : previous.reviewedBy : null;
    const confirm = c.deadlineStatus === "confirmed" && (previous?.deadlineStatus !== "confirmed" || !same(dateBasis(c), dateBasis(previous)));
    if (confirm && (request.confirmDeadline !== true || (c.source && !target))) throw new AppError("Review this deadline and its available source, then tick the deadline confirmation box. Otherwise save the date as proposed.");
    c.confirmedAt = c.deadlineStatus === "confirmed" ? confirm ? now : previous.confirmedAt : null;
    c.confirmedBy = c.deadlineStatus === "confirmed" ? confirm ? actor : previous.confirmedBy : null;
    if (c.status === "done" && !c.completionNote) throw new AppError("Add a completion note explaining what was done and where the record can be found.");
    if (c.status !== "done" && c.completionNote) throw new AppError("Completion notes belong to completed tasks. Clear this field to reopen; the earlier note stays in history.");
    c.completedAt = c.status === "done" ? previous?.status === "done" ? previous.completedAt : now : null;
    return c;
  }
  save(input) {
    this.assertWritable(this.root);
    if (!UUID.test(input.id) || !UUID.test(input.requestId) || !Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) throw new AppError("Reload the task before saving.", 409);
    const actor = text(input.actor ?? "", "Your name", 160, true), reason = text(input.reason ?? "", "Change note", 500, input.expectedRevision > 0);
    const requestHash = hash(JSON.stringify(input));
    const lock = safePath(this.root, LOCK, true);
    try { mkdirSync(lock, { mode: 0o700 }); }
    catch (error) { if (error.code === "EEXIST") throw new AppError("Another task save is in progress. Retry shortly; see the task recovery guide if it persists.", 409); throw error; }
    try {
      const state = this.read(), entry = state.entries[input.id], latest = entry?.revisions.at(-1);
      const retry = entry?.revisions.find((r) => r.requestId === input.requestId);
      if (retry) {
        if (retry.requestHash !== requestHash) throw new AppError("This save identifier was already used for different content. Edit the draft and try again.", 409);
        return this.get(input.id);
      }
      if ((latest?.revision || 0) !== input.expectedRevision) throw new AppError("This task has a newer version. Your draft is still here; read the latest saved version before making changes.", 409);
      const now = this.now().toISOString();
      const content = this.content(input.content, latest?.content, actor, input, now);
      if (content.status === "cancelled" && !reason) throw new AppError("Add a change note explaining the cancellation.");
      const saved = entry || { id: input.id, createdAt: now, revisions: [] };
      saved.revisions.push({ revision: input.expectedRevision + 1, savedAt: now, actor, reason, requestId: input.requestId, requestHash, content });
      state.entries[input.id] = saved;
      this.assertWritable(this.root); writeJson(this.root, STORE, state);
      return this.get(input.id);
    } finally { rmdirSync(lock); }
  }
}
