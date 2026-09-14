import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync, symlinkSync, existsSync, realpathSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "../server.js";
import { buildCaseModel } from "../lib/vault.js";
import { samplePdf, findings } from "./helpers.js";
import { FactRegistry } from "../lib/facts.js";

async function setup(t, overrides = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "strategist-test-")));
  const providers = { connection: { provider: "anthropic", model: "test-model" }, calls: 0,
    status() { return { connection: { provider: "anthropic", model: "test-model", cloud: true } }; },
    async analyse(prompt) { this.calls++; return findings(JSON.parse(prompt).documents[0].id); },
  };
  const server = createServer(overrides.vaultRef ? () => overrides.vaultRef.value || root : root, { preview: true, providers, ...overrides });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const url = `http://127.0.0.1:${server.address().port}`;
  const session = await (await fetch(`${url}/api/session`)).json();
  const request = (path, body, headers = {}) => fetch(url + path, { method: body === undefined ? "GET" : "POST",
    headers: { "x-case-id": session.caseKey, "x-strategist-token": session.token, "content-type": Buffer.isBuffer(body) ? "application/octet-stream" : "application/json", ...headers },
    body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body),
  });
  t.after(async () => { server.inbox.close(); await server.inbox.tail; await new Promise((r) => server.close(r)); rmSync(root, { recursive: true, force: true }); });
  const upload = async (bytes = samplePdf(), name = "letter.pdf") => {
    const response = await request(`/api/documents?name=${encodeURIComponent(name)}`, bytes);
    assert.equal(response.status, 201, await response.clone().text());
    const result = await response.json();
    await server.inbox.tail;
    return result.document.id;
  };
  return { root, server, url, session, request, providers, upload };
}

test("real PDF import, cloud consent, source review, atomic approval and live case model", async (t) => {
  const { root, server, request, providers, upload } = await setup(t);
  writeFileSync(join(root, "my-existing-note.md"), "# Existing note\nDo not change me.\n");
  const before = readFileSync(join(root, "my-existing-note.md"));
  const original = samplePdf(), id = await upload(original);
  const detail = await (await request(`/api/documents/${id}`)).json();
  assert.equal(detail.status, "ready");
  assert.match(detail.pages[0].text, /Alex reported/);
  assert.deepEqual(readFileSync(join(root, detail.original)), original);
  assert.equal(providers.calls, 0, "Import must never send text to a provider");
  assert.equal((await request(`/api/documents/${id}/analyse`, {})).status, 403);
  assert.equal(providers.calls, 0);
  assert.equal((await request(`/api/documents/${id}/analyse`, { consent: true })).status, 202);
  await server.inbox.tail;
  const reviewed = await (await request(`/api/documents/${id}`)).json();
  assert.equal(reviewed.status, "review");
  assert.equal(reviewed.draft.findings[0].verified, true);
  assert.equal(reviewed.draft.findings[2].verified, false);
  assert.equal(buildCaseModel(root).timeline.length, 0, "Drafts must not become timeline facts");
  const bad = await request(`/api/documents/${id}/approve`, { draftId: reviewed.draft.id, findingIds: ["finding-3"] });
  assert.equal(bad.status, 422);
  assert.equal(buildCaseModel(root).evidence.length, 0);
  const payload = { draftId: reviewed.draft.id, findingIds: ["finding-1", "finding-2"] };
  const saved = await request(`/api/documents/${id}/approve`, payload);
  assert.equal(saved.status, 200, await saved.clone().text());
  assert.equal((await request(`/api/documents/${id}/approve`, payload)).status, 200, "Repeat save must be idempotent");
  const model = buildCaseModel(root);
  assert.equal(model.timeline.length, 1);
  assert.equal(model.timeline[0].date, "2024-03-19");
  assert.equal(model.evidence.length, 1);
  assert.equal(model.evidence[0].status, "UNRESOLVED");
  assert.equal(model.evidence[0].strength, null);
  assert.equal(model.stats.documentsAnalysed, 1);
  assert.deepEqual(readFileSync(join(root, "my-existing-note.md")), before);
  assert.deepEqual(readFileSync(join(root, detail.original)), original);
  assert.equal((await request(`/api/documents/${id}`)).status, 200);
  const copy = await request(`/api/documents/${id}/original`);
  assert.deepEqual(Buffer.from(await copy.arrayBuffer()), original);
});

test("duplicate content does not create another original or job", async (t) => {
  const { root, request, upload } = await setup(t);
  const id = await upload();
  const result = await (await request("/api/documents?name=renamed.pdf", samplePdf())).json();
  assert.equal(result.duplicate, true);
  assert.equal(result.document.id, id);
  assert.equal(readdirSync(join(root, ".strategist/documents")).length, 1);
});

test("read-only access does not write any files and rejects imports", async (t) => {
  const { root, request } = await setup(t, { preview: false });
  assert.deepEqual((await (await request("/api/documents")).json()).documents, []);
  assert.equal((await request("/api/documents?name=letter.pdf", samplePdf())).status, 403);
  assert.equal((await request("/api/exports/chronology", {})).status, 403);
  assert.deepEqual(await (await request("/api/facts")).json(), { facts: [] });
  assert.deepEqual(readdirSync(root), []);
});

test("fact API exposes reviewed revisions with case isolation and no verification endpoint", async (t) => {
  const { root, request } = await setup(t);
  writeFileSync(join(root, "source.txt"), "A fictional source passage.");
  const registry = new FactRegistry(root);
  const fact = registry.propose({ actor: "test-agent", statement: "The source contains a fictional passage.", sources: [{ sourceId: "SRC-1", path: "source.txt", locator: "line 1", quote: "A fictional source passage." }] });
  assert.equal((await request("/api/facts", undefined, { "x-case-id": "old-case" })).status, 409);
  const detail = await (await request(`/api/facts/${fact.id}`)).json();
  assert.equal(detail.revisions[0].status, "PROPOSED");
  assert.equal((await request(`/api/facts/${fact.id}/verify`, { confirmVerified: true })).status, 404);
  assert.equal((await request("/api/facts/FACT-99999")).status, 404);
});

test("rejects cross-origin requests, rebinding hosts, missing tokens and stale case IDs", async (t) => {
  const { root, request, url } = await setup(t);
  assert.equal((await request("/api/documents?name=x.pdf", samplePdf(), { origin: "https://attacker.invalid" })).status, 403);
  const hostStatus = await new Promise((resolve, reject) => {
    const req = httpRequest(`${url}/api/session`, { headers: { host: "attacker.invalid" } }, (res) => { res.resume(); resolve(res.statusCode); });
    req.on("error", reject); req.end();
  });
  assert.equal(hostStatus, 403);
  assert.equal((await request("/api/documents?name=x.pdf", samplePdf(), { "x-strategist-token": "" })).status, 403);
  assert.equal((await request("/api/documents?name=x.pdf", samplePdf(), { "x-case-id": "old-case" })).status, 409);
  assert.equal((await fetch(`${url}/api/session`, { headers: { "sec-fetch-site": "cross-site" } })).status, 403);
  assert.deepEqual(readdirSync(root), []);
});

test("rejects symlinked storage without modifying its target", async (t) => {
  const { root, request } = await setup(t);
  const outside = mkdtempSync(join(tmpdir(), "strategist-outside-"));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  try { symlinkSync(outside, join(root, ".strategist"), "dir"); }
  catch (error) { if (error.code === "EPERM") return t.skip("Symlinks unavailable"); throw error; }
  assert.equal((await request("/api/documents?name=x.pdf", samplePdf())).status, 409);
  assert.deepEqual(readdirSync(outside), []);
});

test("invalid PDFs and scans never produce fabricated extracted text", async (t) => {
  const { request, upload, providers } = await setup(t);
  assert.equal((await request("/api/documents?name=x.pdf", Buffer.from("Not a PDF"))).status, 400);
  const id = await upload(samplePdf(""));
  const detail = await (await request(`/api/documents/${id}`)).json();
  assert.equal(detail.status, "needs_ocr");
  assert.equal((await request(`/api/documents/${id}/analyse`, { consent: true })).status, 400);
  assert.equal(providers.calls, 0);
});

test("licence expiry during analysis blocks saving results and preserves originals", async (t) => {
  let writable = true, release;
  const { root, server, request, providers, upload } = await setup(t, { getAccess: () => ({ canWrite: writable, mode: writable ? "active" : "expired" }) });
  providers.analyse = (prompt) => new Promise((resolve) => { release = () => resolve(findings(JSON.parse(prompt).documents[0].id)); });
  const id = await upload();
  await request(`/api/documents/${id}/analyse`, { consent: true });
  await new Promise((r) => setImmediate(r));
  writable = false;
  release(); await server.inbox.tail;
  const detail = await (await request(`/api/documents/${id}`)).json();
  assert.equal(detail.status, "failed");
  assert.match(detail.error, /entitlement/);
  assert.equal(detail.draft, null);
  assert.ok(existsSync(join(root, detail.original)));
  assert.equal((await request(`/api/documents/${id}/approve`, { findingIds: ["finding-1"] })).status, 403);
});

test("cancelled requests cannot publish late provider results", async (t) => {
  let release;
  const { server, request, providers, upload } = await setup(t);
  providers.analyse = (prompt) => new Promise((resolve) => { release = () => resolve(findings(JSON.parse(prompt).documents[0].id)); });
  const id = await upload();
  await request(`/api/documents/${id}/analyse`, { consent: true });
  await new Promise((r) => setImmediate(r));
  assert.equal((await request(`/api/documents/${id}/cancel`, {})).status, 200);
  release(); await server.inbox.tail;
  const detail = await (await request(`/api/documents/${id}`)).json();
  assert.equal(detail.status, "cancelled");
  assert.equal(detail.draft, null);
});

test("interrupted jobs are shown without restarting a provider call", async (t) => {
  const { root, request, providers, upload } = await setup(t);
  const id = await upload();
  const path = join(root, ".strategist/documents", id, "document.json");
  const record = JSON.parse(readFileSync(path)); record.status = "analysing"; writeFileSync(path, JSON.stringify(record));
  const detail = await (await request(`/api/documents/${id}`)).json();
  assert.equal(detail.status, "interrupted");
  assert.equal(providers.calls, 0);
});

test("changed originals and stale draft approvals are rejected", async (t) => {
  const { root, server, request, upload } = await setup(t);
  const id = await upload();
  await request(`/api/documents/${id}/analyse`, { consent: true }); await server.inbox.tail;
  const detail = await (await request(`/api/documents/${id}`)).json();
  assert.equal((await request(`/api/documents/${id}/approve`, { draftId: "stale", findingIds: ["finding-1"] })).status, 409);
  writeFileSync(join(root, detail.original), "Changed outside the app");
  assert.equal((await request(`/api/documents/${id}/approve`, { draftId: detail.draft.id, findingIds: ["finding-1"] })).status, 409);
  assert.equal(buildCaseModel(root).timeline.length, 0);
});

test("comparison documents are included only when selected; case switch cannot redirect an ongoing job", async (t) => {
  const other = mkdtempSync(join(tmpdir(), "strategist-second-"));
  t.after(() => rmSync(other, { recursive: true, force: true }));
  const vaultRef = { value: null };
  const { root, server, providers, request, upload } = await setup(t, { vaultRef });
  const one = await upload(), two = await upload(Buffer.from("A different case document with text."), "second.txt");
  let submitted, release;
  providers.analyse = (prompt) => { submitted = JSON.parse(prompt); return new Promise((r) => { release = () => r(findings(one)); }); };
  await request(`/api/documents/${one}/analyse`, { consent: true, relatedIds: [two] });
  await new Promise((r) => setImmediate(r));
  vaultRef.value = other;
  assert.equal((await request("/api/documents")).status, 409);
  release(); await server.inbox.tail;
  assert.deepEqual(submitted.documents.map((d) => d.id), [one, two]);
  assert.deepEqual(readdirSync(other), []);
  assert.equal(server.inbox.detail(root, one).status, "review");
});
