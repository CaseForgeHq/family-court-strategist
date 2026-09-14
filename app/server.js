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
  const getAccess = (root) => options.getAccess?.(root) || {
    canWrite: options.preview === true,
    mode: options.preview === true ? "development" : "read-only",
    message: options.preview === true ? "Development preview · billing is not connected" : "Read-only workspace · choose a writable development case to try document intake",
  };
  const assertWritable = (root) => {
    if (getAccess(root).canWrite !== true) throw new AppError("This workspace is read-only. An active app entitlement is required to import, analyse or save findings.", 403);
  };
  const inbox = new Inbox({ providers, assertWritable, ...(options.extract ? { extract: options.extract } : {}) });
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
      if (url.pathname.startsWith("/api/")) {
        const root = caseRoot(resolveVault());
        const caseKey = createHash("sha256").update(root).digest("hex");
        if (req.method === "GET" && url.pathname === "/api/session") return json(200, { token, caseKey, access: getAccess(root), ...providers.status() });
        if (req.method !== "GET") {
          if (req.method !== "POST") throw new AppError("Method not allowed.", 405);
          if (req.headers["x-strategist-token"] !== token) throw new AppError("Reload the app before continuing.", 403);
        }
        if (url.pathname !== "/api/case" && req.headers["x-case-id"] !== caseKey) throw new AppError("The active case has changed. Reload before continuing.", 409);
        if (req.method === "GET" && url.pathname === "/api/case") return json(200, buildCaseModel(root));
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
          try { body = JSON.parse((await readBody(req, 16_000)).toString("utf8")); }
          catch (error) { if (error instanceof AppError) throw error; throw new AppError("Invalid request."); }
          if (!body || typeof body !== "object" || Array.isArray(body)) throw new AppError("Invalid request.");
          if (caseRoot(resolveVault()) !== root) throw new AppError("The active case changed. Reload before continuing.", 409);
          if (url.pathname === "/api/providers/connect") {
            assertWritable(root);
            return json(200, await providers.connect(body));
          }
          if (url.pathname === "/api/providers/disconnect") { providers.disconnect(); return json(200, providers.status()); }
          if (url.pathname === "/api/exports/chronology") { assertWritable(root); return json(200, buildCaseModel(root)); }
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
      if (!["/index.html", "/app.css", "/app.js", "/inbox.js", "/brand/tokens.css", "/brand/logo.svg", "/brand/logo-reversed.svg", "/brand/symbol.svg", "/brand/favicon.svg", "/brand/fonts/InterVariable.woff2", "/brand/fonts/EBGaramond-Variable.ttf"].includes(rel)) throw new AppError("Not found.", 404);
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
  server.on("close", () => inbox.close());
  server.inbox = inbox;
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
