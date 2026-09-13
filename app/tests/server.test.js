import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "../server.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sampleCase = join(__dirname, "..", "..", "sample-case");

const server = createServer(sampleCase);
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
after(() => server.close());

test("binds to loopback only", () => {
  assert.equal(server.address().address, "127.0.0.1");
});

test("GET /api/case returns the case model as JSON", async () => {
  const res = await fetch(`http://127.0.0.1:${port}/api/case`);
  assert.equal(res.status, 200);
  const model = await res.json();
  assert.equal(model.stats.timelineEvents, 5);
  assert.equal(Array.isArray(model.timeline), true);
});

test("serves the UI shell at /", async () => {
  const res = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.equal(html.includes("<!DOCTYPE html>"), true);
});

test("rejects path traversal", async () => {
  const res = await fetch(`http://127.0.0.1:${port}/../server.js`);
  assert.equal(res.status === 400 || res.status === 404, true);
});

test("vault.js uses no network or fs-write APIs", async () => {
  const src = await readFile(new URL("../lib/vault.js", import.meta.url), "utf8");
  for (const banned of ["writeFile", "appendFile", "unlink", "fetch(", "net."]) {
    assert.equal(src.includes(banned), false, `vault.js must not use ${banned}`);
  }
});

test("opening the default viewer does not create case storage or connect a provider", async () => {
  const before = await readdir(sampleCase);
  const session = await (await fetch(`http://127.0.0.1:${port}/api/session`)).json();
  assert.equal(session.access.canWrite, false);
  assert.equal(session.connection, null);
  assert.equal(session.claudeCodeEnabled, false);
  assert.deepEqual(await readdir(sampleCase), before);
});
