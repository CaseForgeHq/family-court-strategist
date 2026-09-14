import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, rmdirSync } from "node:fs";
import { extname } from "node:path";
import { AppError } from "./errors.js";
import { caseRoot, safePath, readLocal, readJson, writeJson, writeNew } from "./files.js";

// Proposal: https://github.com/CaseForgeHq/family-court-strategist/issues/1
// Original fact-locking and propagation idea: @bambam624.
const STORE = ".case-forge/facts/registry.json";
const LOCK = ".case-forge/facts/write.lock";
const ID = /^FACT-\d{5,}$/;
const hash = (value) => createHash("sha256").update(value).digest("hex");
const digest = (value) => hash(JSON.stringify(value));
const fail = (message) => { throw new AppError(message, 409); };
function text(value, name, max = 8000) {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new AppError(`Supply ${name} (up to ${max} characters).`);
  return value; // Preserve exact spelling, whitespace, dates and quotes.
}
function factIn(state, id) {
  if (!ID.test(id) || !state.facts[id]) throw new AppError("Fact not found.", 404);
  return state.facts[id];
}
const latest = (fact) => fact.revisions.at(-1);
const openConflicts = (fact) => fact.conflicts.filter((c) => c.status === "OPEN");
function expected(fact, revision) {
  if (revision !== latest(fact).revision) fail("The fact changed. Review the current revision before continuing.");
}
function review(input) {
  if (input.confirmVerified !== true) throw new AppError("Explicit human verification is required. Source matching alone does not establish truth.");
  return { reviewer: text(input.reviewer, "the human reviewer's name", 200), reason: text(input.reason, "a verification reason"), at: new Date().toISOString() };
}
function payload(root, input) {
  const statement = text(input.statement, "an exact statement");
  if (statement.includes("{{fact:") || statement.includes("<!-- case-forge:") || statement.includes("<!-- /case-forge:")) throw new AppError("Fact statements cannot contain reference or lock markers.");
  if (!Array.isArray(input.sources) || !input.sources.length || input.sources.length > 20) throw new AppError("Supply between one and twenty supporting sources.");
  const sources = input.sources.map((source) => {
    if (!source || typeof source !== "object") throw new AppError("Invalid source.");
    const path = text(source.path, "a source path", 1000);
    if (path.split(/[\\/]/).includes("..") || path.startsWith("/") || path.startsWith(".case-forge/facts/")) throw new AppError("Use a relative path to original evidence inside this case.");
    const bytes = readLocal(root, path);
    const quote = text(source.quote, "an exact supporting quote");
    const quoteChecked = [".txt", ".md"].includes(extname(path).toLowerCase());
    if (quoteChecked && !bytes.toString("utf8").includes(quote)) fail("The exact quote does not occur in the source file.");
    return { sourceId: text(source.sourceId, "a source ID", 200), path, locator: text(source.locator, "a page, paragraph or timestamp", 1000), quote, sha256: hash(bytes), quoteChecked };
  });
  return { statement, sources };
}
function checkSources(root, value) {
  for (const source of value.sources) {
    if (hash(readLocal(root, source.path)) !== source.sha256) fail(`Source changed: ${source.sourceId}. Review the evidence again.`);
  }
}

export class FactRegistry {
  constructor(root) { this.root = caseRoot(root); }

  read() {
    let state;
    try { state = readJson(this.root, STORE); }
    catch (error) {
      if (error.code === "ENOENT") return { schemaVersion: 1, sequence: 0, facts: {}, events: [], exports: [], checksum: null };
      if (error instanceof SyntaxError) fail("Fact registry integrity check failed: invalid JSON. Restore a trusted backup.");
      throw error;
    }
    if (!state || typeof state !== "object" || !state.facts || !Array.isArray(state.events) || !Array.isArray(state.exports)) fail("Fact registry integrity check failed: invalid structure.");
    const { checksum, ...data } = state;
    if (state.schemaVersion !== 1 || checksum !== digest(data)) fail("Fact registry integrity check failed. Restore a trusted backup; do not regenerate its checksum.");
    let previousHash = null;
    for (const event of state.events) {
      const { hash: eventHash, ...body } = event;
      if (body.previousHash !== previousHash || eventHash !== digest(body)) fail("Fact audit history integrity check failed.");
      previousHash = eventHash;
    }
    for (const fact of Object.values(state.facts)) {
      let previousRevisionHash = null;
      for (const revision of fact.revisions) {
        const { hash: revisionHash, ...body } = revision;
        if (body.previousHash !== previousRevisionHash || revisionHash !== digest(body)) fail("Fact revision integrity check failed.");
        previousRevisionHash = revisionHash;
      }
    }
    return state;
  }

  #mutate(action) {
    const lock = safePath(this.root, LOCK, true);
    try { mkdirSync(lock, { mode: 0o700 }); }
    catch (error) { if (error.code === "EEXIST") fail("Another fact operation holds the write lock. If it crashed, inspect and remove the empty write.lock directory before retrying."); throw error; }
    try {
      const state = this.read();
      const result = action(state);
      const { checksum: ignored, ...data } = state;
      writeJson(this.root, STORE, { ...data, checksum: digest(data) });
      return result;
    } finally { rmdirSync(lock); }
  }

  #event(state, type, fact, actor, detail = {}) {
    const body = { sequence: state.events.length + 1, type, factId: fact.id, actor: text(actor, "an actor", 200), at: new Date().toISOString(), ...detail, previousHash: state.events.at(-1)?.hash || null };
    state.events.push({ ...body, hash: digest(body) });
  }

  #revision(fact, value, status, verification = null) {
    const body = { revision: fact.revisions.length + 1, ...value, status, verification, previousHash: latest(fact)?.hash || null };
    const result = { ...body, hash: digest(body) };
    fact.revisions.push(result);
    return result;
  }

  list() {
    return Object.values(this.read().facts).map((fact) => ({ id: fact.id, ...latest(fact), openConflicts: openConflicts(fact).length }));
  }
  get(id) { return factIn(this.read(), id); }

  propose(input) {
    return this.#mutate((state) => {
      const value = payload(this.root, input);
      const id = `FACT-${String(++state.sequence).padStart(5, "0")}`;
      const fact = { id, revisions: [], conflicts: [] };
      this.#revision(fact, value, "PROPOSED");
      state.facts[id] = fact;
      this.#event(state, "PROPOSED", fact, input.actor, { revision: 1 });
      return fact;
    });
  }

  verify(id, input) {
    return this.#mutate((state) => {
      const fact = factIn(state, id);
      expected(fact, input.expectedRevision);
      const current = latest(fact);
      if (current.status !== "PROPOSED") fail("Verified facts are locked. Propose a conflict for review instead of editing them.");
      checkSources(this.root, current);
      const verification = review(input);
      this.#revision(fact, { statement: current.statement, sources: current.sources }, "VERIFIED", verification);
      this.#event(state, "VERIFIED", fact, verification.reviewer, { revision: latest(fact).revision, reason: verification.reason });
      return fact;
    });
  }

  conflict(id, input) {
    return this.#mutate((state) => {
      const fact = factIn(state, id);
      expected(fact, input.expectedRevision);
      if (latest(fact).status !== "VERIFIED") fail("Verify the proposed fact before opening a correction review.");
      const conflict = { id: `CONFLICT-${randomUUID()}`, baseRevision: latest(fact).revision, ...payload(this.root, input), reason: text(input.reason, "a conflict reason"), status: "OPEN", createdAt: new Date().toISOString() };
      fact.conflicts.push(conflict);
      this.#event(state, "CONFLICT_OPENED", fact, input.actor, { conflictId: conflict.id });
      return conflict;
    });
  }

  resolve(id, input) {
    return this.#mutate((state) => {
      const fact = factIn(state, id);
      expected(fact, input.expectedRevision);
      const conflict = fact.conflicts.find((c) => c.id === input.conflictId);
      if (!conflict || conflict.status !== "OPEN") fail("Open conflict not found.");
      if (!["accept", "reject"].includes(input.decision)) throw new AppError("Choose accept or reject.");
      const verification = review(input);
      if (input.decision === "accept") {
        checkSources(this.root, conflict);
        this.#revision(fact, { statement: conflict.statement, sources: conflict.sources }, "VERIFIED", verification);
      } else {
        checkSources(this.root, latest(fact));
      }
      conflict.status = input.decision === "accept" ? "ACCEPTED" : "REJECTED";
      conflict.resolution = { ...verification, reviewedRevision: input.expectedRevision };
      this.#event(state, `CONFLICT_${conflict.status}`, fact, verification.reviewer, { conflictId: conflict.id, revision: latest(fact).revision, reason: verification.reason });
      return fact;
    });
  }

  render(markdown) {
    if (markdown.includes("<!-- case-forge:") || markdown.includes("<!-- /case-forge:")) fail("Render from reference templates, not exported lock blocks. Existing snapshots must remain unchanged.");
    const state = this.read();
    const dependencies = [];
    const content = markdown.replace(/\{\{fact:([^}\r\n]*)\}\}/g, (_, ref) => {
      const match = ref.match(/^(FACT-\d{5,})(?:@(\d+))?$/);
      if (!match) fail(`Invalid fact reference: ${ref}`);
      const fact = factIn(state, match[1]);
      const revision = match[2] ? fact.revisions.find((r) => r.revision === Number(match[2])) : latest(fact);
      if (!revision || revision.status !== "VERIFIED") fail(`Reference ${ref} is not a verified revision.`);
      if (!match[2] && openConflicts(fact).length) fail(`${fact.id} has an unresolved conflict. Review it before generating current documents.`);
      checkSources(this.root, revision);
      dependencies.push({ factId: fact.id, revision: revision.revision, hash: revision.hash, pinned: !!match[2] });
      return `<!-- case-forge:fact ${fact.id} revision=${revision.revision} sha256=${revision.hash} pinned=${!!match[2]} -->\n${revision.statement}\n<!-- /case-forge:fact -->`;
    });
    // Fail closed for malformed tokens instead of silently exporting unresolved text.
    if (content.includes("{{fact:")) fail("Malformed fact reference.");
    return { content, dependencies };
  }

  export(template, destination) {
    text(destination, "an export path", 1000);
    if (destination.startsWith("/") || destination.split(/[\\/]/).some((part) => part.startsWith(".") || ["_system", "_templates"].includes(part)) || extname(destination).toLowerCase() !== ".md") throw new AppError("Export to a new .md file in a visible case folder, using a relative path.");
    // Serialize registry changes with export so the snapshot records one revision set.
    return this.#mutate((state) => {
      const rendered = this.render(readLocal(this.root, template).toString("utf8"));
      if (!rendered.dependencies.length) throw new AppError("The template contains no canonical fact references.");
      writeNew(this.root, destination, rendered.content);
      state.exports.push({ path: destination, template, sha256: hash(rendered.content), dependencies: rendered.dependencies, createdAt: new Date().toISOString() });
      return { path: destination, dependencies: rendered.dependencies };
    });
  }

  check() {
    const state = this.read();
    const issues = [], usages = [];
    for (const snapshot of state.exports) {
      try {
        if (hash(readLocal(this.root, snapshot.path)) !== snapshot.sha256) issues.push({ path: snapshot.path, type: "EXPORT_CHANGED" });
      } catch (error) { issues.push({ path: snapshot.path, type: "EXPORT_MISSING_OR_UNREADABLE", message: error.message }); }
    }
    for (const fact of Object.values(state.facts)) {
      if (openConflicts(fact).length) issues.push({ factId: fact.id, type: "OPEN_CONFLICT" });
      try { checkSources(this.root, latest(fact)); }
      catch (error) { issues.push({ factId: fact.id, type: "SOURCE_CHANGED_OR_MISSING", message: error.message }); }
    }
    const inspect = (path) => {
      const markdown = readLocal(this.root, path).toString("utf8");
      for (const match of markdown.matchAll(/\{\{fact:([^}\r\n]*)\}\}/g)) {
        usages.push({ path, reference: match[1], kind: "live" });
        try { this.render(match[0]); }
        catch (error) { issues.push({ path, type: "INVALID_REFERENCE", message: error.message }); }
      }
      if (markdown.replace(/\{\{fact:([^}\r\n]*)\}\}/g, "").includes("{{fact:")) issues.push({ path, type: "MALFORMED_REFERENCE" });
      const blocks = /<!-- case-forge:fact (FACT-\d{5,}) revision=(\d+) sha256=([a-f0-9]{64}) pinned=(true|false) -->\n([\s\S]*?)\n<!-- \/case-forge:fact -->/g;
      let count = 0;
      for (const match of markdown.matchAll(blocks)) {
        count++;
        const [, id, number, sha, pinned, statement] = match;
        const fact = state.facts[id], revision = fact?.revisions.find((r) => r.revision === Number(number));
        usages.push({ path, factId: id, revision: Number(number), kind: "snapshot", pinned: pinned === "true" });
        if (!revision || revision.status !== "VERIFIED" || sha !== revision.hash || statement !== revision.statement) issues.push({ path, factId: id, type: "LOCK_DRIFT" });
        else {
          if (pinned === "false" && revision.revision !== latest(fact).revision) issues.push({ path, factId: id, type: "STALE_SNAPSHOT" });
          try { checkSources(this.root, revision); }
          catch (error) { issues.push({ path, factId: id, type: "SOURCE_CHANGED_OR_MISSING", message: error.message }); }
        }
      }
      if ((markdown.match(/<!-- case-forge:fact/g) || []).length !== count || (markdown.match(/<!-- \/case-forge:fact/g) || []).length !== count) issues.push({ path, type: "MALFORMED_LOCK" });
    };
    const walk = (dir = "") => {
      for (const entry of readdirSync(dir ? safePath(this.root, dir) : this.root, { withFileTypes: true })) {
        if (entry.name.startsWith(".") || entry.isSymbolicLink() || ["_system", "_templates"].includes(entry.name)) continue;
        const path = dir ? `${dir}/${entry.name}` : entry.name;
        if (entry.isDirectory()) walk(path);
        else if (entry.isFile() && entry.name.endsWith(".md")) inspect(path);
      }
    };
    walk();
    return { ok: issues.length === 0, issues, usages };
  }
}
