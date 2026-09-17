import { createServer as httpCreate } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, createHash } from "node:crypto";
import { mkdtemp, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { buildCaseModel } from "./lib/vault.js";
import { caseRoot, readLocal, safePath } from "./lib/files.js";
import { AppError, publicError } from "./lib/errors.js";
import { Providers } from "./lib/providers.js";
import { FilesAI } from "./lib/files-ai.js";
import { MAX_DOCUMENT_BYTES, SUPPORTED_EXTENSIONS } from "./lib/document-readers.js";
import { getReaderStatus, provisionReaders } from "./lib/reader-dependencies.js";
import { FactRegistry } from "./lib/facts.js";
import { Journal, journalTargets } from "./lib/journal.js";
import { Tasks, taskTargets } from "./lib/tasks.js";
import { Calendar } from "./lib/calendar.js";
import { Notebook } from "./lib/notebook.js";
import { addPerson } from "./lib/people.js";
import { buildSearchIndex, searchIndex, createAsyncSearchReviews, sqliteSearchRecord, documentSearchRecord, SEARCH_TYPES } from "./lib/case-index.js";
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
  const inbox = new FilesAI({ assertWritable, getAccess, fileReferences: options.fileReferences, scan: options.scanDocument,
    ...(options.readDocument ? {read:options.readDocument}:{}), ...(options.analyseDocument ? {analyse:options.analyseDocument}:{}),
    ...(options.fetchLaw ? {fetchImpl:options.fetchLaw}:{}), readerOptions:options.readerOptions || {} });
  let readerSetup = {state:'idle'}, readerSetupTask = null;
  const searchSnapshot = async ({query='',history=false,mode='all',deep=false}={}) => {
    const root = caseRoot(resolveVault());
    await inbox.open(root);
    const documents = inbox.sourceRecords(root), journal = new Journal(root);
    const index=buildSearchIndex({ root, model: caseModel(root), documents, journal,
      tasks: new Tasks(root, { getTargets: () => taskTargets(root, documents, journal.list()) }), calendar: new Calendar(root), notebook: new Notebook(root), facts: new FactRegistry(root) });
    if(documents.some(doc=>doc.fileTextIndexed)) {
      const result=await inbox.searchDocuments(root,query,{history,mode,limit:10000});
      const records=result.rows.map(sqliteSearchRecord);
      index.externalFileResults=records;
      if(deep){const fileKeys=new Set(records.map(record=>record.key));index.records=index.records.filter(record=>!fileKeys.has(record.key));index.records.push(...records);}
      index.fingerprint=createHash('sha256').update(`${root}:${index.fingerprint}:${result.revision}`).digest('hex');
      index.coverage.current+=result.stats.currentReports;
      index.coverage.historical+=result.stats.reports-result.stats.currentReports;
      index.coverage.counts.draft=result.stats.currentReports;
      if(result.stats.unreadDocuments)index.coverage.gaps.push({title:'Files awaiting reading',reason:`${result.stats.unreadDocuments} imported files have no extracted text. Their file details remain searchable; use Scan to read their contents.`});
      if(result.total>result.rows.length)index.coverage.gaps.push({title:'File search',reason:'More than 10,000 file/report matches. Narrow the query to see all results.'});
      index.coverage.fileSearch='SQLite FTS5';
    }
    return index;
  };
  const searchReviews = createAsyncSearchReviews(searchSnapshot);
  const server = httpCreate(async (req, res) => {
    const json = (status, body) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    try {
      res.setHeader("cache-control", "no-store");
      res.setHeader("x-content-type-options", "nosniff");
      res.setHeader("referrer-policy", "no-referrer");
      res.setHeader("cross-origin-resource-policy", "same-origin");
      res.setHeader("content-security-policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; frame-src blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
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
        await inbox.open(root);
        if (req.method === "GET" && url.pathname === "/api/providers/local-models") return json(200, await providers.localModels());
        if (req.method === "GET" && url.pathname === "/api/case") return json(200, { ...caseModel(root), isSample: options.isSample?.(root) === true });
        const notebook = new Notebook(root, { assertWritable });
        const documentDrafts = new Notebook(root, { assertWritable, collection: 'documents' });
        if (req.method === 'GET' && url.pathname === '/api/document-drafts') return json(200, { pages: documentDrafts.list() });
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
        if (req.method === 'GET' && url.pathname === '/api/search') {
          const query=url.searchParams.get('q') || '', searchOptions={type:url.searchParams.get('type') || '',history:url.searchParams.get('history')==='true',offset:url.searchParams.get('offset'),mode:url.searchParams.get('mode')};
          if(query.length>300)throw new AppError('Use a search of up to 300 characters.');
          return json(200,{...searchIndex(await searchSnapshot({query,...searchOptions}),query,searchOptions),types:SEARCH_TYPES});
        }
        if (req.method === 'GET' && url.pathname === '/api/search/record') {
          const key=url.searchParams.get('key'), fileKey=/^document:([a-f0-9]{64})(?::r([^:]+):draft)?$/.exec(key || '');
          const record = fileKey ? documentSearchRecord(await inbox.detail(root,fileKey[1]),fileKey[2]):(await searchSnapshot()).records.find(r => r.key === key);
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
        if (req.method === 'GET' && url.pathname === '/api/scan-settings') return json(200, await inbox.settings(root));
        if (req.method === 'GET' && url.pathname === '/api/readers') { const {paths,directory,...status}=await getReaderStatus({directory:options.readerOptions?.directory});return json(200,{...status,setup:readerSetup}); }
        if (req.method === 'GET' && url.pathname === '/api/files/search') return json(200, {results:await inbox.search(root,url.searchParams.get('q') || '')});
        if (req.method === "GET" && url.pathname === "/api/documents") return json(200, { documents: inbox.list(root), access: getAccess(root) });
        if (req.method === "POST" && url.pathname === "/api/documents") {
          assertWritable(root);
          const bytes = await readBody(req, MAX_DOCUMENT_BYTES);
          // Case selection can change while a large upload is arriving.
          if (caseRoot(resolveVault()) !== root) throw new AppError("The active case changed during import. Add the document again.", 409);
          return json(201, await inbox.import(root, url.searchParams.get("name"), bytes));
        }
        const match = url.pathname.match(/^\/api\/documents\/([a-f0-9]{64})(?:\/(scan|pause|resume|next|analyse|approve|cancel|retry|open-native|original|source|image|report))?$/);
        if (match && req.method === 'POST' && match[2] === 'open-native') {
          if (!options.openNativeDocument) throw new AppError('Open this file from the Case Forge desktop app.', 400);
          const document = inbox.record(root, match[1]);
          const file = safePath(root, document.original);
          if (!SUPPORTED_EXTENSIONS.includes(extname(file).toLowerCase())) throw new AppError('This file type cannot be opened from Case Forge.', 400);
          if (caseRoot(resolveVault()) !== root || (options.isUnlocked && !options.isUnlocked())) throw new AppError('The workspace changed. Reopen the file.', 409);
          const error = await options.openNativeDocument(file);
          if (error) throw new AppError('Windows could not open this file. Check that it still exists and a default app is installed for this file type.', 400);
          return json(200, { opened: true });
        }
        if (match && req.method === "GET" && !match[2]) return json(200, await inbox.detail(root, match[1]));
        if (match && req.method === 'GET' && match[2] === 'source') {
          const detail=await inbox.detail(root,match[1]),page=Number(url.searchParams.get('page'));
          const reportId=url.searchParams.get('reportId'),report=reportId ? detail.reports.find(r=>r.id===reportId):detail.reports[0];
          if(reportId && !report)throw new AppError('Report version unavailable.',404);
          const sourceMatch=url.searchParams.get('sourceMatch');
          const transcription=report?.sourcePages?.find(p=>p.page===page && p.machineTranscribed);
          const original=report?.sourcePages?.find(p=>p.page===page && !p.machineTranscribed) || detail.pages.find(p=>p.page===page);
          const source=sourceMatch==='text_match' ? original : transcription || original;
          if(!source)throw new AppError('Source excerpt unavailable. Open the original file.',404);
          return json(200,{documentId:detail.id,name:detail.name,reference:detail.reference,...source});
        }
        if (match && req.method === 'GET' && match[2] === 'image') {
          const detail=await inbox.detail(root,match[1]),reportId=url.searchParams.get('reportId');
          const images=reportId ? detail.reports.find(r=>r.id===reportId)?.sourceImages || []:detail.images;
          const image=images.find(p=>p.page===Number(url.searchParams.get('page')));
          if(!image)throw new AppError('Source image unavailable.',404);
          const bytes=readLocal(root,image.path);
          const imageType={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'}[extname(image.path).toLowerCase()];
          if(!imageType)throw new AppError('Unsupported preview format.',415);
          res.writeHead(200,{'content-type':imageType});return res.end(bytes);
        }
        if (match && req.method === 'GET' && match[2] === 'report') {
          const detail=await inbox.detail(root,match[1]),report=detail.reports.find(r=>r.id===url.searchParams.get('id')) || detail.reports[0];
          if(!report?.markdown)throw new AppError('Report unavailable.',404);
          res.writeHead(200,{'content-type':'text/markdown; charset=utf-8','content-disposition':`attachment; filename="${detail.reference || 'scan'}-report.md"`});return res.end(report.markdown);
        }
        if (match && req.method === "GET" && match[2] === "original") {
          const document = inbox.record(root, match[1]);
          const bytes = readLocal(root, document.original);
          const mime={'.pdf':'application/pdf','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.mp3':'audio/mpeg','.wav':'audio/wav','.mp4':'video/mp4','.webm':'video/webm','.txt':'text/plain; charset=utf-8','.md':'text/plain; charset=utf-8'}[document.extension] || 'application/octet-stream';
          res.writeHead(200, { "content-type": mime, "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(document.name)}` });
          return res.end(bytes);
        }
        if (req.method === "POST") {
          if (!req.headers["content-type"]?.startsWith("application/json")) throw new AppError("Expected a JSON request.", 415);
          let body;
          try { body = JSON.parse((await readBody(req, url.pathname === '/api/document-drafts' ? 400000 : url.pathname === '/api/notebook' ? 64000 : 16_000)).toString("utf8")); }
          catch (error) { if (error instanceof AppError) throw error; throw new AppError("Invalid request."); }
          if (!body || typeof body !== "object" || Array.isArray(body)) throw new AppError("Invalid request.");
          if (caseRoot(resolveVault()) !== root) throw new AppError("The active case changed. Reload before continuing.", 409);
          if (url.pathname === '/api/search/prepare') return json(200, await searchReviews.prepare(body));
          if (url.pathname === '/api/scan-settings') return json(200, await inbox.settings(root,body));
          if (url.pathname === '/api/case-backup') return json(200, await inbox.backup(root));
          if (url.pathname === '/api/readers/setup') {
            assertWritable(root);
            if(!readerSetupTask) {
              readerSetup={state:'installing',message:'Preparing local document readers…'};
              readerSetupTask=provisionReaders({directory:options.readerOptions?.directory,onProgress:progress=>{readerSetup={state:'installing',progress};}})
                .then(()=>{readerSetup={state:'ready'};}).catch(error=>{readerSetup={state:'failed',message:error.message};}).finally(()=>{readerSetupTask=null;});
            }
            return json(202,readerSetup);
          }
          if (url.pathname === "/api/journal") return json(200, journal.save(body));
          if (url.pathname === "/api/tasks") return json(200, tasks.save(body));
          if (url.pathname === "/api/calendar") return json(200, calendar.save(body));
          if (url.pathname === '/api/document-drafts') return json(200, documentDrafts.save(body));
          if (url.pathname === '/api/notebook') return json(200, notebook.save(body));
          if (url.pathname === '/api/notebook/delete') return json(200, notebook.delete(body));
          if (url.pathname === '/api/people') return json(200, addPerson(root, body, { assertWritable, model: caseModel(root) }));
          if (url.pathname === "/api/providers/connect") {
            assertWritable(root);
            return json(200, await providers.connect(body));
          }
          if (url.pathname === "/api/providers/disconnect") { providers.disconnect(); return json(200, providers.status()); }
          if (url.pathname === "/api/exports/chronology") { assertWritable(root); return json(200, caseModel(root)); }
          if (match) {
            if (match[2] === 'scan') return json(202,{scan:await inbox.enqueue(root,match[1],body)});
            if (['pause','resume','next','cancel','retry'].includes(match[2])) return json(200,{scan:await inbox.control(root,match[1],match[2],body)});
            if (['analyse','approve'].includes(match[2])) throw new AppError('Use Scan in Case desk. Findings now stay in Files & AI.',410);
          }
        }
        throw new AppError("Not found.", 404);
      }
      if (req.method !== "GET") throw new AppError("Method not allowed.", 405);
      const rel = url.pathname === "/" ? "/index.html" : url.pathname;
      if (!["/case-details.css", "/case-details.js", "/assistant.css", "/chatgpt-connection.js", "/vendor/deep-chat/2.5.1/deepChat.bundle.js", "/vendor/openai/monoblossom-white.svg", "/vendor/openai/monoblossom-black.svg", "/files-ai.css", "/document-model.js", "/document-creator.js", "/document-creator.css", "/updates.js", "/updates.css", "/search.css", "/case-menu.js", "/layout.css", "/notebook.js", "/file-register.js", "/windows.js", "/refinement.css", "/admin.js", "/admin.css", "/topbar.css", "/map-space.css", "/map-layout.js", "/map-scene.js", "/vendor/three/three.module.js", "/vendor/three/three.core.js", "/vendor/three/OrbitControls.js", "/icons.js", "/search.js", "/assistant.js", "/calendar.js", "/calendar.css", "/index.html", "/app.css", "/app.js", "/workspace.css", "/workspace-chrome.js", "/scene/landscape.css", "/scene/landscape.js", "/scene/scene-time.js", "/scene/scene-controls.css", "/scene/scene-controls.js", "/scene/fonts/Ubuntu-Regular.ttf", "/scene/fonts/Quicksand-VariableFont_wght.ttf", "/graph.js", "/graph.css", "/inbox.js", "/journal.js", "/tasks.js", "/brand/tokens.css", "/brand/logo.svg", "/brand/logo-reversed.svg", "/brand/symbol.svg", "/brand/favicon.svg", "/brand/fonts/InterVariable.woff2", "/brand/fonts/EBGaramond-Variable.ttf"].includes(rel)) throw new AppError("Not found.", 404);
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
  server.closeWorkspace = () => { searchReviews.clear(); providers.disconnect?.(); return inbox.close(); };
  server.on('close',()=>{void inbox.close();});
  const closeHTTP=server.close.bind(server);
  server.close=callback=>{closeHTTP(async(...args)=>{await server.closeWorkspace();callback?.(...args);});return server;};
  server.takeSearchReview = async value => {
    if (options.isUnlocked && !options.isUnlocked()) throw new AppError('Unlock your workspace first.', 423);
    const caseKey = createHash('sha256').update(caseRoot(resolveVault())).digest('hex');
    if (value?.caseKey !== caseKey) throw new AppError('The active case changed. Prepare a fresh search.', 409);
    const review=await searchReviews.take(value?.reviewId, value?.consent);
    if (options.isUnlocked && !options.isUnlocked()) throw new AppError('Unlock your workspace first.', 423);
    if (createHash('sha256').update(caseRoot(resolveVault())).digest('hex')!==caseKey)throw new AppError('The active case changed. Prepare a fresh search.',409);
    return review;
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
