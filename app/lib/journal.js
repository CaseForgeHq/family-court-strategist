import { mkdirSync, readdirSync, lstatSync, rmdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { caseRoot, readJson, readLocal, safePath, writeJson } from "./files.js";
import { parseFrontmatter } from "./frontmatter.js";
import { AppError } from "./errors.js";

const STORE = ".case-forge/journal/registry.json";
const LOCK = ".case-forge/journal/write.lock";
const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const text = (value, label, max, required = false) => {
  if (typeof value !== "string" || value.length > max || value.includes("\0") || (required && !value.trim())) {
    throw new AppError(`${label}: enter ${required ? "1–" : "up to "}${max} characters.`);
  }
  return value.trim();
};

// Titles and relative references only. Hidden storage and symlinks are never
// crawled; reading the journal cannot feed private content into the case model.
export function journalTargets(root, documents = []) {
  root = caseRoot(root);
  const targets = [];
  function walk(dir = "") {
    for (const name of readdirSync(dir ? safePath(root, dir) : root)) {
      if (name.startsWith(".") || name.startsWith("_")) continue;
      const rel = dir ? `${dir}/${name}` : name;
      const st = lstatSync(join(root, rel));
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) { walk(rel); continue; }
      if (!st.isFile() || !name.endsWith(".md")) continue;
      const { data, body } = parseFrontmatter(readLocal(root, rel).toString("utf8"));
      if (data.type === "journal") continue;
      const kind = data.event_id && data.date ? "event" : data.type;
      if (!["event", "person", "pattern", "issue", "evidence", "legal"].includes(kind)) continue;
      const title = body.match(/^#\s+(.+)$/m)?.[1]?.trim() || name;
      targets.push({ id: `note:${rel}`, kind, title });
    }
  }
  walk();
  return [...targets, ...documents.map((d) => ({ id: `document:${d.id}`, kind: "document", title: d.name }))];
}

export class Journal {
  constructor(root, { assertWritable = () => {}, getTargets } = {}) {
    this.root = caseRoot(root);
    this.assertWritable = assertWritable;
    this.getTargets = getTargets || (() => journalTargets(this.root));
  }

  read() {
    let state;
    try { state = readJson(this.root, STORE); }
    catch (error) { if (error.code === "ENOENT") return { schemaVersion: 1, entries: {} }; throw error; }
    if (state.schemaVersion !== 1 || !state.entries || typeof state.entries !== "object" || Array.isArray(state.entries) ||
      Object.entries(state.entries).some(([id, e]) => !ID.test(id) || e.id !== id || !Array.isArray(e.revisions) || !e.revisions.length ||
        e.revisions.some((r, i) => r.revision !== i + 1 || !r.content || typeof r.savedAt !== "string"))) {
      throw new AppError("Journal storage could not be read. Restore a known backup before editing.", 409);
    }
    return state;
  }

  list() {
    return Object.values(this.read().entries).map((e) => {
      const latest = e.revisions.at(-1);
      return { id: e.id, recordedAt: e.recordedAt, updatedAt: latest.savedAt, revision: latest.revision,
        title: latest.content.title, occurredDate: latest.content.occurredDate, occurredTime: latest.content.occurredTime,
        precision: latest.content.precision, timeZone: latest.content.timeZone, status: "PERSONAL_ACCOUNT" };
    }).sort((a, b) => b.recordedAt.localeCompare(a.recordedAt) || a.id.localeCompare(b.id));
  }

  get(id) {
    if (!ID.test(id)) throw new AppError("Journal entry not found.", 404);
    const entry = this.read().entries[id];
    if (!entry) throw new AppError("Journal entry not found.", 404);
    const ids = new Set(this.getTargets().map((t) => t.id));
    return { ...entry, status: "PERSONAL_ACCOUNT", revisions: entry.revisions.map((r) => ({ ...r,
      content: { ...r.content, links: r.content.links.map((l) => ({ ...l, available: ids.has(l.id) })) } })) };
  }

  content(input, previous) {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new AppError("Enter a journal account.");
    const value = {};
    for (const [key, label, max, required] of [["title", "Title", 160, true], ["happened", "What happened", 4000],
      ["words", "Remembered words", 3000], ["reflection", "Personal reflection", 3000],
      ["occurredDate", "Event date", 10], ["occurredTime", "Event time", 5], ["timeZone", "Time zone", 80, true]]) {
      value[key] = text(input[key] ?? "", label, max, required);
    }
    if (![value.happened, value.words, value.reflection].some(Boolean)) throw new AppError("Write an account, remembered words or a reflection.");
    if (!["exact", "approximate", "unknown"].includes(input.precision)) throw new AppError("Choose how certain the event date/time is.");
    value.precision = input.precision;
    if (value.occurredDate && (!/^\d{4}-\d{2}-\d{2}$/.test(value.occurredDate) || value.occurredDate.startsWith("0000") ||
      !Number.isFinite(Date.parse(`${value.occurredDate}T00:00:00Z`)) || new Date(`${value.occurredDate}T00:00:00Z`).toISOString().slice(0, 10) !== value.occurredDate)) {
      throw new AppError("Enter a valid event date.");
    }
    if (value.occurredTime && (!value.occurredDate || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.occurredTime))) throw new AppError("A valid event time needs an event date.");
    if (value.precision === "unknown" && (value.occurredDate || value.occurredTime)) throw new AppError("Clear the event date/time when timing is unknown, or choose exact or approximate.");
    if (value.precision !== "unknown" && !value.occurredDate) throw new AppError("Enter an event date or choose unknown timing.");
    try { new Intl.DateTimeFormat("en", { timeZone: value.timeZone }); }
    catch { throw new AppError("Use a valid time zone, such as Australia/Sydney."); }
    if (!Array.isArray(input.links) || input.links.length > 20 || input.links.some((id) => typeof id !== "string")) throw new AppError("Choose up to 20 linked records.");
    const targets = new Map(this.getTargets().map((t) => [t.id, t]));
    value.links = [...new Set(input.links)].sort().map((id) => {
      const target = targets.get(id) || previous?.links.find((l) => l.id === id);
      if (!target) throw new AppError("A linked record is no longer available. Refresh the linked records and try again.", 409);
      return { id: target.id, kind: target.kind, title: target.title };
    });
    return value;
  }

  save(input) {
    this.assertWritable(this.root);
    const id = input.id || randomUUID();
    if (!ID.test(id)) throw new AppError("Invalid journal entry identifier.");
    const lock = safePath(this.root, LOCK, true);
    try { mkdirSync(lock, { mode: 0o700 }); }
    catch (error) {
      if (error.code === "EEXIST") throw new AppError("Another journal save is in progress. Retry shortly. If it persists after a restart, see the journal recovery guide.", 409);
      throw error;
    }
    try {
      const state = this.read();
      const entry = state.entries[id];
      const latest = entry?.revisions.at(-1);
      if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) throw new AppError("Reload the entry before saving.", 409);
      const content = this.content(input.content, latest?.content);
      const reason = text(input.reason ?? "", "Correction reason", 500, input.expectedRevision > 0);
      // A lost response can be retried without creating a second entry/revision.
      if (latest?.revision === input.expectedRevision + 1 && JSON.stringify(latest.content) === JSON.stringify(content) && latest.reason === reason) return this.get(id);
      if ((latest?.revision || 0) !== input.expectedRevision) throw new AppError("This entry has a newer version. Your draft is still here; read the latest saved entry before applying your correction.", 409);
      const now = new Date().toISOString();
      const saved = entry || { id, recordedAt: now, revisions: [] };
      saved.revisions.push({ revision: input.expectedRevision + 1, savedAt: now, reason, content });
      state.entries[id] = saved;
      this.assertWritable(this.root);
      writeJson(this.root, STORE, state);
      return this.get(id);
    } finally { rmdirSync(lock); }
  }
}
