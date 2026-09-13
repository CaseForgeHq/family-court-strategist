import { createHash, randomUUID } from "node:crypto";
import { readdirSync, existsSync, renameSync, rmSync } from "node:fs";
import { extname } from "node:path";
import { AppError, publicError } from "./errors.js";
import { safePath, readLocal, readJson, writeJson, writeNew } from "./files.js";
import { extractDocument, MAX_UPLOAD } from "./extraction.js";
import { analysisPrompt, validateAnalysis } from "./analysis.js";

const ID = /^[a-f0-9]{64}$/;
const BUSY = new Set(["queued_read", "reading", "queued", "analysing"]);
const base = (id) => {
  if (!ID.test(id)) throw new AppError("Document not found.", 404);
  return `.strategist/documents/${id}`;
};
const now = () => new Date().toISOString();
const yaml = (v) => JSON.stringify(String(v));
const prose = (v) => String(v).replace(/^---\s*$/gm, "—");

export class Inbox {
  constructor({ providers, assertWritable, extract = extractDocument }) {
    this.providers = providers;
    this.assertWritable = assertWritable;
    this.extract = extract;
    this.jobs = new Map();
    this.tail = Promise.resolve();
    this.closed = false;
  }

  key(root, id) { return `${root}:${id}`; }
  record(root, id) {
    try { return readJson(root, `${base(id)}/document.json`); }
    catch (error) { if (error.code === "ENOENT") throw new AppError("Document not found.", 404); throw error; }
  }
  put(root, record) { writeJson(root, `${base(record.id)}/document.json`, { ...record, updatedAt: now() }); }
  patch(root, id, patch) { const record = { ...this.record(root, id), ...patch }; this.put(root, record); return record; }

  list(root) {
    const folder = safePath(root, ".strategist/documents");
    if (!existsSync(folder)) return [];
    return readdirSync(folder).filter((id) => ID.test(id)).flatMap((id) => {
      try {
        const record = this.record(root, id);
        // Recovery is read-only. Never resume an external call silently after a restart.
        if (this.saved(root, id)) record.status = "saved";
        else if (BUSY.has(record.status) && !this.jobs.has(this.key(root, id))) {
          record.status = "interrupted";
          record.error = "The app stopped before this job finished. Retry when you are ready.";
        }
        return [record];
      } catch { return []; }
    }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  detail(root, id) {
    const record = this.list(root).find((d) => d.id === id);
    if (!record) throw new AppError("Document not found.", 404);
    const pagesPath = `${base(id)}/pages.json`, draftPath = `${base(id)}/draft.json`;
    return { ...record,
      pages: existsSync(safePath(root, pagesPath)) ? readJson(root, pagesPath) : [],
      draft: existsSync(safePath(root, draftPath)) ? readJson(root, draftPath) : null,
      saved: this.saved(root, id),
    };
  }

  saved(root, id) {
    base(id);
    const path = `legal-documents/strategist-${id}/approval.json`;
    return existsSync(safePath(root, path)) ? readJson(root, path) : null;
  }

  enqueue(root, id, run) {
    if (this.closed) throw new AppError("The app is shutting down. Reopen it before starting work.", 503);
    const key = this.key(root, id);
    if (this.jobs.has(key)) throw new AppError("This document already has a job running.", 409);
    if (this.jobs.size >= 20) throw new AppError("The queue is full. Wait for a document to finish.", 429);
    const controller = new AbortController();
    this.jobs.set(key, controller);
    const task = this.tail.then(async () => {
      try {
        if (controller.signal.aborted) return;
        this.assertWritable(root);
        await run(controller.signal);
      } catch (error) {
        try { this.patch(root, id, { status: controller.signal.aborted ? "cancelled" : "failed", error: publicError(error) }); } catch { /* case removed or storage unavailable */ }
      } finally { this.jobs.delete(key); }
    });
    this.tail = task.catch(() => {});
  }

  import(root, filename, bytes) {
    this.assertWritable(root);
    if (typeof filename !== "string") throw new AppError("Choose a document.");
    const name = filename.split(/[\\/]/).pop().replace(/[\x00-\x1f\x7f]/g, "").trim();
    const extension = extname(name).toLowerCase();
    if (!name || name.length > 180 || ![".pdf", ".txt", ".md"].includes(extension)) throw new AppError("Choose a PDF, TXT or Markdown file. Word and image imports will follow in a later version.");
    if (!bytes.length || bytes.length > MAX_UPLOAD) throw new AppError("Choose a non-empty document up to 20 MB.", 413);
    if (extension === ".pdf" && !bytes.subarray(0, 1024).includes(Buffer.from("%PDF-"))) throw new AppError("This file does not contain a PDF. Your case has not been changed.");
    const id = createHash("sha256").update(bytes).digest("hex");
    if (existsSync(safePath(root, `${base(id)}/document.json`))) return { document: this.detail(root, id), duplicate: true };
    if (this.jobs.size >= 20) throw new AppError("The queue is full. Wait for a document to finish.", 429);
    const original = `${base(id)}/original${extension}`;
    if (!existsSync(safePath(root, original))) writeNew(root, original, bytes);
    const record = { id, name, extension, bytes: bytes.length, original, status: "queued_read", createdAt: now(), error: null };
    this.put(root, record);
    this.read(root, id);
    return { document: record, duplicate: false };
  }

  read(root, id) {
    this.assertWritable(root);
    this.enqueue(root, id, async (signal) => {
      const record = this.patch(root, id, { status: "reading", error: null });
      const bytes = readLocal(root, record.original);
      if (createHash("sha256").update(bytes).digest("hex") !== id) throw new AppError("The stored original has changed. Reimport the document before continuing.", 409);
      const pages = await this.extract(bytes, record.extension, signal);
      signal.throwIfAborted();
      this.assertWritable(root);
      writeJson(root, `${base(id)}/pages.json`, pages);
      const emptyPages = pages.filter((p) => !p.text.trim()).map((p) => p.page);
      this.patch(root, id, { status: emptyPages.length === pages.length ? "needs_ocr" : "ready", pageCount: pages.length, emptyPages,
        error: emptyPages.length === pages.length ? "No readable text was found. Scanned PDFs need text recognition; import a searchable PDF for now." : null });
    });
  }

  source(root, id) {
    const document = this.record(root, id);
    if (!existsSync(safePath(root, `${base(id)}/pages.json`))) throw new AppError("Wait for document reading to finish.", 409);
    const bytes = readLocal(root, document.original);
    if (createHash("sha256").update(bytes).digest("hex") !== id) throw new AppError("A stored original has changed. Reimport it before continuing.", 409);
    const pages = readJson(root, `${base(id)}/pages.json`);
    if (!pages.some((p) => p.text.trim())) throw new AppError("This document needs text recognition before analysis.");
    return { id, name: document.name, pages };
  }

  analyse(root, id, { relatedIds = [], consent = false } = {}) {
    this.assertWritable(root);
    if (this.saved(root, id)) throw new AppError("This document's findings have already been saved. The saved case notes remain editable in your own tools.", 409);
    if (this.jobs.has(this.key(root, id))) throw new AppError("Wait for this document's current job to finish.", 409);
    if (!Array.isArray(relatedIds) || relatedIds.length > 3 || relatedIds.some((v) => typeof v !== "string" || !ID.test(v))) throw new AppError("Choose up to three comparison documents.");
    const connection = this.providers.connection;
    if (!connection) throw new AppError("Connect your AI first.", 409);
    if (connection.provider !== "ollama" && consent !== true) throw new AppError("Confirm that the selected document text may be sent to Claude for this analysis.", 403);
    const ids = [...new Set([id, ...relatedIds])];
    const documents = ids.map((docId) => this.source(root, docId));
    const prompt = analysisPrompt(documents); // Reject oversize before any external call.
    this.patch(root, id, { status: "queued", error: null });
    this.enqueue(root, id, async (signal) => {
      this.patch(root, id, { status: "analysing" });
      const result = await this.providers.analyse(prompt, signal, connection);
      signal.throwIfAborted();
      this.assertWritable(root);
      const validated = validateAnalysis(result, documents);
      writeJson(root, `${base(id)}/draft.json`, { ...validated, id: randomUUID(), sourceIds: ids,
        provider: connection.provider, model: connection.model, createdAt: now(),
        partialPages: documents.flatMap((d) => d.pages.filter((p) => !p.text.trim()).map((p) => `${d.name}, page ${p.page}`)),
      });
      this.patch(root, id, { status: "review", error: null });
    });
  }

  retryRead(root, id) {
    if (this.jobs.has(this.key(root, id))) throw new AppError("This document is already processing.", 409);
    if (this.saved(root, id)) throw new AppError("This document has already been saved.", 409);
    this.read(root, id);
  }

  cancel(root, id) {
    const controller = this.jobs.get(this.key(root, id));
    if (!controller) throw new AppError("There is no running job for this document.", 409);
    controller.abort();
    this.patch(root, id, { status: "cancelled", error: "Job cancelled. The original document is still available." });
  }

  approve(root, id, { draftId, findingIds } = {}) {
    this.assertWritable(root);
    const existing = this.saved(root, id);
    if (existing) return existing; // Idempotent after a response loss or app restart.
    if (this.jobs.has(this.key(root, id))) throw new AppError("Wait for analysis to finish before saving.", 409);
    const record = this.record(root, id);
    if (record.status !== "review") throw new AppError("This document is not ready for review.", 409);
    const draft = readJson(root, `${base(id)}/draft.json`);
    if (draftId !== draft.id) throw new AppError("These findings have changed. Reopen the review before saving.", 409);
    if (!Array.isArray(findingIds) || !findingIds.length || findingIds.length > 30 || new Set(findingIds).size !== findingIds.length) throw new AppError("Select at least one source-matched finding to save.");
    // Revalidate references from disk; client-provided text and verification flags
    // are never accepted. UI review sends IDs only.
    const documents = draft.sourceIds.map((docId) => this.source(root, docId));
    const checked = validateAnalysis(draft, documents);
    const selected = findingIds.map((findingId) => checked.findings.find((f) => f.id === findingId));
    if (selected.some((f) => !f || !f.verified)) throw new AppError("Only findings with matching source quotes and valid dates can be saved.", 422);
    const destination = `legal-documents/strategist-${id}`;
    const stage = `.strategist/staging/${randomUUID()}`;
    const approvedAt = now();
    const approval = { documentId: id, draftId, approvedAt, findingIds, folder: destination };
    try {
      writeNew(root, `${stage}/analysis.md`, `---\ntype: legal\nsource_file: ${yaml(record.original)}\nreviewed_at: ${yaml(approvedAt)}\n---\n# Reviewed findings: ${record.name.replace(/[\r\n]/g, " ")}\n\nSelected AI-assisted findings were reviewed by the user on ${approvedAt}. Source matching is not verification that a claim is true.\n\nProvider: ${draft.provider}; model: ${draft.model}.\n\nOnly selected findings are included. See the linked finding notes in this folder.\n`);
      for (const finding of selected) {
        const source = finding.sources[0];
        const sourceRecord = this.record(root, source.documentId);
        const kind = finding.kind === "event" ? "incident" : "evidence";
        const matter = finding.kind === "inconsistency" ? "[contradiction]" : "[]";
        const frontmatter = `---\ntype: ${kind}\n${finding.date ? `date: ${finding.date}\nevent_id: DOC-${id.slice(0, 12)}-${finding.id}\n` : ""}issue: ${matter}\nstatus: UNRESOLVED\nsource_file: ${yaml(sourceRecord.original)}\nsource_name: ${yaml(sourceRecord.name)}\nsource_page: ${source.page}\nreviewed_at: ${yaml(approvedAt)}\n---\n`;
        const citations = finding.sources.map((s) => {
          const original = this.record(root, s.documentId).original;
          return `### ${s.name.replace(/[\r\n]/g, " ")} — page ${s.page}\n\n[Open source document](../../${original}#page=${s.page})\n\n${s.quote.split(/\r?\n/).map((line) => `> ${line}`).join("\n")}`;
        }).join("\n\n");
        writeNew(root, `${stage}/${finding.id}.md`, `${frontmatter}# ${finding.title}\n\n${prose(finding.detail)}\n\nKind: ${finding.kind}. Reviewed draft; not an independent finding of fact.\n\n## Sources\n\n${citations}\n`);
      }
      writeNew(root, `${stage}/approval.json`, JSON.stringify(approval, null, 2));
      this.assertWritable(root);
      const target = safePath(root, destination, true);
      if (existsSync(target)) throw new AppError("A case folder already exists for these findings. It has not been overwritten.", 409);
      renameSync(safePath(root, stage), target); // Atomic publication of the whole reviewed batch.
    } finally {
      const path = safePath(root, stage);
      if (existsSync(path)) rmSync(path, { recursive: true, force: true });
    }
    this.patch(root, id, { status: "saved", error: null });
    return approval;
  }

  close() {
    this.closed = true;
    for (const controller of this.jobs.values()) controller.abort();
  }
}
