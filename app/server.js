import { createServer as httpCreate } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, createHash } from "node:crypto";
import { mkdtemp, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { buildCaseModel } from "./lib/vault.js";
import { caseRoot, readLocal } from "./lib/files.js";
import { AppError, publicError } from "./lib/errors.js";
import { Providers } from "./lib/providers.js";
import { Inbox } from "./lib/inbox.js";
import { MAX_UPLOAD } from "./lib/extraction.js";
import { FactRegistry } from "./lib/facts.js";
import { Journal, journalTargets } from "./lib/journal.js";
import { Tasks, taskTargets } from "./lib/tasks.js";
import { Calendar } from "./lib/calendar.js";
import { Notebook } from "./lib/notebook.js";
import { addPerson } from "./lib/people.js";
import { buildSearchIndex, searchIndex, createSearchReviews, SEARCH_TYPES } from "./lib/case-index.js";
import { parseFrontmatter } from "./lib/frontmatter.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(__dirname, "public");
const TYPES = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

async function readBody(req, limit) {
  if (Number(req.headers["content-length"]) > limit) throw new AppError("This file or request is too large.", 413);
  const chunks = [];
  let bytes = 0;
  for await (const part of req) {
    bytes += part.length;
    if (bytes > limit) throw new AppError("This file or request is too large.", 413);
    chunks.push(part);
  }
  return Buffer.concat(chunks);
}

export function createServer(vaultDir, options = {}) {
  // vaultDir may be a string (fixed) or a function returning the current path,
  // so a host (e.g. the desktop app) can switch vaults without recreating the server.
  const resolveVault = typeof vaultDir === "function" ? vaultDir : () => vaultDir;
  const token = randomBytes(32).toString("hex");
  const providers = options.providers || new Providers({ enableClaudeCode: options.enableClaudeCode === true });
  const getWorkspacePreferences = (root) => options.getWorkspacePreferences?.(root);
  const caseModel = (root) => {
    const model = buildCaseModel(root), preferences = getWorkspacePreferences(root);
    return preferences?.caseName ? { ...model, caseName: preferences.caseName } : model;
  };
  const getAccess = (root) => options.getAccess?.(root) || {
    canWrite: options.preview === true,
    mode: options.preview === true ? "development" : "read-only",
    message: options.preview === true ? "Development preview · billing is not connected" : "Read-only workspace · choose a writable development case to try document intake",
  };
  const assertWritable = (root) => {
    if (options.isUnlocked && !options.isUnlocked()) throw new AppError("Your workspace is locked.", 423);
    if (getAccess(root).canWrite !== true) throw new AppError("This workspace is read-only. An active app entitlement is required to import, analyse or save changes.", 403);
  };
  const inbox = new Inbox({ providers, assertWritable, fileReferences: options.fileReferences, ...(options.extract ? { extract: options.extract } : {}) });
  const searchSnapshot = () => {
    const root = caseRoot(resolveVault());
    const documents = inbox.list(root), journal = new Journal(root);
    return buildSearchIndex({ root, model: caseModel(root), documents, journal,
      tasks: new Tasks(root, { getTargets: () => taskTargets(root, documents, journal.list()) }), calendar: new Calendar(root), notebook: new Notebook(root), facts: new FactRegistry(root) });
  };
  const searchReviews = createSearchReviews(searchSnapshot);
  const server = httpCreate(async (req, res) => {
    const json = (status, body) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    try {
      res.setHeader("cache-control", "no-store");
      res.setHeader("x-content-type-options", "nosniff");
      res.setHeader("referrer-policy", "no-referrer");
      res.setHeader("cross-origin-resource-policy", "same-origin");
      res.setHeader("content-security-policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
      const host = req.headers.host;
      const port = server.address()?.port;
      if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(host)) throw new AppError("Unrecognised local host.", 403);
      if ((req.headers.origin && req.headers.origin !== `http://${host}`) || req.headers["sec-fetch-site"] === "cross-site") throw new AppError("Cross-site access is not allowed.", 403);
      const url = new URL(req.url, "http://127.0.0.1");
      if (options.desktopToken && (req.headers['x-caseforge-desktop'] !== options.desktopToken || (options.isUnlocked && !options.isUnlocked()))) throw new AppError("Open and unlock the Case Forge desktop app to continue.", 401);
      if (url.pathname.startsWith("/api/")) {
        const root = caseRoot(resolveVault());
        const caseKey = createHash("sha256").update(root).digest("hex");
        if (req.method === "GET" && url.pathname === "/api/session") return json(200, { token, caseKey, access: getAccess(root), ...providers.status(), workspacePreferences: getWorkspacePreferences(root) });
        if (req.method !== "GET") {
          if (req.method !== "POST") throw new AppError("Method not allowed.", 405);
          if (req.headers["x-strategist-token"] !== token) throw new AppError("Reload the app before continuing.", 403);
        }
        if (url.pathname !== "/api/case" && req.headers["x-case-id"] !== caseKey) throw new AppError("The active case has changed. Reload before continuing.", 409);
        if (req.method === "GET" && url.pathname === "/api/providers/local-models") return json(200, await providers.localModels());
        if (req.method === "GET" && url.pathname === "/api/case") return json(200, { ...caseModel(root), isSample: options.isSample?.(root) === true });
        const notebook = new Notebook(root, { assertWritable });
        if (req.method === 'GET' && url.pathname === '/api/notebook') return json(200, { pages: notebook.list(), access: getAccess(root) });
        const journal = new Journal(root, { assertWritable, getTargets: () => journalTargets(root, inbox.list(root)) });
        if (req.method === "GET" && url.pathname === "/api/journal") return json(200, { entries: journal.list(), access: getAccess(root) });
        if (req.method === "GET" && url.pathname === "/api/journal/targets") return json(200, { targets: journal.getTargets() });
        const journalMatch = url.pathname.match(/^\/api\/journal\/([a-f0-9-]{36})$/);
        if (req.method === "GET" && journalMatch) return json(200, journal.get(journalMatch[1]));
        const targetsForTasks = (includeJournal = true) => taskTargets(root, inbox.list(root), includeJournal ? journal.list() : []);
        const tasks = new Tasks(root, { assertWritable, getTargets: targetsForTasks });
        const calendar = new Calendar(root, { assertWritable, getTasks: () => tasks.list(), getTimeline: () => caseModel(root).timeline });
        if (req.method === "GET" && url.pathname === "/api/calendar") return json(200, { events:calendar.list(), access:getAccess(root) });
        if (req.method === 'GET' && url.pathname === '/api/search') return json(200, { ...searchIndex(searchSnapshot(), url.searchParams.get('q') || '', {
          type: url.searchParams.get('type') || '', history: url.searchParams.get('history') === 'true', offset: url.searchParams.get('offset'), mode: url.searchParams.get('mode') }), types: SEARCH_TYPES });
        if (req.method === 'GET' && url.pathname === '/api/search/record') {
          const record = searchSnapshot().records.find(r => r.key === url.searchParams.get('key'));
          if (!record) throw new AppError('This saved record changed or is unavailable. Refresh search.', 404);
          let remaining = 200000, clipped = false;
          const parts = record.parts.map(p => { const text = p.text.slice(0, remaining); remaining -= text.length; if(text.length < p.text.length) clipped = true; return { ...p, text }; }).filter(p => p.text);
          return json(200, { ...record, parts, clipped });
        }
        if (req.method === "GET" && url.pathname === "/api/notes") {
          const id = url.searchParams.get('path'), model = caseModel(root);
          const node = model.graph.nodes.find(n => n.id === id && !n.id.startsWith('source:') && !n.id.startsWith('topic:'));
          if (!node || !id.endsWith('.md')) throw new AppError('This case note is unavailable.',404);
          const raw = readLocal(root,id); if (raw.length > 500000) throw new AppError('This note is too large to preview. Open it in your case folder.',413);
          const {body,data} = parseFrontmatter(raw.toString('utf8'));
          const documents = inbox.list(root), source = documents.find(d => d.original === data.source_file);
          const related = model.graph.edges.filter(e => e.source === id || e.target === id).map(e => model.graph.nodes.find(n => n.id === (e.source === id ? e.target : e.source))).filter(n => n && !n.id.startsWith('topic:'));
          return json(200,{title:node.label,reference:id,body,source:source ? {id:source.id,name:source.name,reference:source.reference} : null,related});
        }
        if (req.method === "GET" && url.pathname === "/api/tasks") return json(200, { ...tasks.list(), access: getAccess(root) });
        if (req.method === "GET" && url.pathname === "/api/tasks/targets") return json(200, { targets: targetsForTasks(false) });
        if (req.method === "GET" && url.pathname === "/api/tasks/journal-targets") return json(200, { targets: targetsForTasks().filter((t) => t.kind === "journal") });
        const taskMatch = url.pathname.match(/^\/api\/tasks\/([a-f0-9-]{36})$/);
        if (req.method === "GET" && taskMatch) return json(200, tasks.get(taskMatch[1]));
        if (req.method === "GET" && url.pathname === "/api/facts") return json(200, { facts: new FactRegistry(root).list() });
        const factMatch = url.pathname.match(/^\/api\/facts\/(FACT-\d{5,})$/);
        if (req.method === "GET" && factMatch) return json(200, new FactRegistry(root).get(factMatch[1]));
        if (req.method === "GET" && url.pathname === "/api/documents") return json(200, { documents: inbox.list(root), access: getAccess(root) });
        if (req.method === "POST" && url.pathname === "/api/documents") {
          assertWritable(root);
          const bytes = await readBody(req, MAX_UPLOAD);
          // Case selection can change while a large upload is arriving.
          if (caseRoot(resolveVault()) !== root) throw new AppError("The active case changed during import. Add the document again.", 409);
          return json(201, inbox.import(root, url.searchParams.get("name"), bytes));
        }
        const match = url.pathname.match(/^\/api\/documents\/([a-f0-9]{64})(?:\/(analyse|approve|cancel|retry|original))?$/);
        if (match && req.method === "GET" && !match[2]) return json(200, inbox.detail(root, match[1]));
        if (match && req.method === "GET" && match[2] === "original") {
          const document = inbox.record(root, match[1]);
          const bytes = readLocal(root, document.original);
          res.writeHead(200, { "content-type": "application/octet-stream", "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(document.name)}` });
          return res.end(bytes);
        }
        if (req.method === "POST") {
          if (!req.headers["content-type"]?.startsWith("application/json")) throw new AppError("Expected a JSON request.", 415);
          let body;
          try { body = JSON.parse((await readBody(req, url.pathname === '/api/notebook' ? 64000 : 16_000)).toString("utf8")); }
          catch (error) { if (error instanceof AppError) throw error; throw new AppError("Invalid request."); }
          if (!body || typeof body !== "object" || Array.isArray(body)) throw new AppError("Invalid request.");
          if (caseRoot(resolveVault()) !== root) throw new AppError("The active case changed. Reload before continuing.", 409);
          if (url.pathname === '/api/search/prepare') return json(200, searchReviews.prepare(body));
          if (url.pathname === "/api/journal") return json(200, journal.save(body));
          if (url.pathname === "/api/tasks") return json(200, tasks.save(body));
          if (url.pathname === "/api/calendar") return json(200, calendar.save(body));
          if (url.pathname === '/api/notebook') return json(200, notebook.save(body));
          if (url.pathname === '/api/people') return json(200, addPerson(root, body, { assertWritable, model: caseModel(root) }));
          if (url.pathname === "/api/providers/connect") {
            assertWritable(root);
            return json(200, await providers.connect(body));
          }
          if (url.pathname === "/api/providers/disconnect") { providers.disconnect(); return json(200, providers.status()); }
          if (url.pathname === "/api/exports/chronology") { assertWritable(root); return json(200, caseModel(root)); }
          if (match) {
            if (match[2] === "analyse") { inbox.analyse(root, match[1], body); return json(202, { queued: true }); }
            if (match[2] === "approve") return json(200, inbox.approve(root, match[1], body));
            if (match[2] === "cancel") { inbox.cancel(root, match[1]); return json(200, { cancelled: true }); }
            if (match[2] === "retry") { inbox.retryRead(root, match[1]); return json(202, { queued: true }); }
          }
        }
        throw new AppError("Not found.", 404);
      }
      if (req.method !== "GET") throw new AppError("Method not allowed.", 405);
      const rel = url.pathname === "/" ? "/index.html" : url.pathname;
      if (!["/updates.js", "/updates.css", "/search.css", "/case-menu.js", "/layout.css", "/notebook.js", "/file-register.js", "/windows.js", "/refinement.css", "/admin.js", "/admin.css", "/topbar.css", "/map-space.css", "/map-layout.js", "/map-scene.js", "/vendor/three/three.module.js", "/vendor/three/three.core.js", "/vendor/three/OrbitControls.js", "/icons.js", "/search.js", "/assistant.js", "/calendar.js", "/calendar.css", "/index.html", "/app.css", "/app.js", "/workspace.css", "/workspace-chrome.js", "/scene/landscape.css", "/scene/landscape.js", "/scene/scene-time.js", "/scene/scene-controls.css", "/scene/scene-controls.js", "/scene/fonts/Ubuntu-Regular.ttf", "/scene/fonts/Quicksand-VariableFont_wght.ttf", "/graph.js", "/graph.css", "/inbox.js", "/journal.js", "/tasks.js", "/brand/tokens.css", "/brand/logo.svg", "/brand/logo-reversed.svg", "/brand/symbol.svg", "/brand/favicon.svg", "/brand/fonts/InterVariable.woff2", "/brand/fonts/EBGaramond-Variable.ttf"].includes(rel)) throw new AppError("Not found.", 404);
      const full = join(PUBLIC, rel);
      const body = await readFile(full);
      res.writeHead(200, { "content-type": TYPES[extname(full)] || "application/octet-stream" });
      res.end(body);
    } catch (err) {
      if (!res.headersSent) json(err.status || (err.code === "ENOENT" ? 404 : 500), { error: publicError(err) });
      else res.end();
    }
  });
  server.requestTimeout = 60_000;
  server.headersTimeout = 15_000;
  server.closeWorkspace = () => { searchReviews.clear(); inbox.close(); providers.disconnect?.(); };
  server.takeSearchReview = value => {
    if (options.isUnlocked && !options.isUnlocked()) throw new AppError('Unlock your workspace first.', 423);
    const caseKey = createHash('sha256').update(caseRoot(resolveVault())).digest('hex');
    if (value?.caseKey !== caseKey) throw new AppError('The active case changed. Prepare a fresh search.', 409);
    return searchReviews.take(value?.reviewId, value?.consent);
  };
  server.on("close", server.closeWorkspace);
  server.inbox = inbox;
  server.calendarEntries = () => {
    const root = caseRoot(resolveVault()); assertWritable(root);
    const journal = new Journal(root,{assertWritable,getTargets:()=>journalTargets(root,inbox.list(root))});
    const tasks = new Tasks(root,{assertWritable,getTargets:()=>taskTargets(root,inbox.list(root),journal.list())});
    return {caseKey:createHash('sha256').update(root).digest('hex'),events:new Calendar(root,{assertWritable,getTasks:()=>tasks.list(),getTimeline:()=>caseModel(root).timeline}).list()};
  };
  return server;
}

function openBrowser(url) {
  import("node:child_process").then(({ spawn }) => {
    const cmd =
      process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
    try {
      spawn(cmd, [url], { stdio: "ignore", detached: true, shell: process.platform === "win32" }).unref();
    } catch {
      /* user opens the URL manually */
    }
  });
}

// CLI entry: node server.js [vaultPath]
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const preview = args.includes("--preview");
  let vaultDir = args.find((arg) => !arg.startsWith("--")) || join(__dirname, "..", "sample-case");
  if (preview && !args.some((arg) => !arg.startsWith("--"))) {
    const temp = await mkdtemp(join(tmpdir(), "strategist-preview-"));
    vaultDir = join(temp, "sample-case");
    await cp(join(__dirname, "..", "sample-case"), vaultDir, { recursive: true });
  }
  const port = Number(process.env.PORT) || 4173;
  const server = createServer(vaultDir, { preview, enableClaudeCode: args.includes("--claude-code") });
  server.listen(port, "127.0.0.1", () => {
    const url = `http://127.0.0.1:${port}`;
    console.log(`\n  Case Forge — local workspace\n  Vault:  ${vaultDir}\n  Open:   ${url}\n  ${preview ? "Writable development preview · billing not connected" : "Read-only"}\n  AI runs only when requested. Ctrl+C to stop.\n`);
    if (!args.includes("--no-open")) openBrowser(url);
  });
  const stop = () => { server.inbox.close(); server.close(); };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
