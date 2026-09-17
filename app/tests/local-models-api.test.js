import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "../server.js";
import { Providers } from "../lib/providers.js";
import { fileURLToPath } from "node:url";

test("local model discovery requires the desktop capability, case scope and same origin", async (t) => {
  let unlocked = true, calls = 0;
  const providers = new Providers({ fetchImpl: async () => { calls++; return new Response(JSON.stringify({ models: [{ name: "local:8b" }] })); } });
  const server = createServer(fileURLToPath(new URL("../../sample-case", import.meta.url)), { desktopToken: "synthetic-desktop-capability", isUnlocked: () => unlocked, providers });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`, path = `${origin}/api/providers/local-models`;
  const capability = { "x-caseforge-desktop": "synthetic-desktop-capability" };
  assert.equal((await fetch(path)).status, 401);
  assert.equal((await fetch(path, { headers: capability })).status, 409);
  const session = await (await fetch(`${origin}/api/session`, { headers: capability })).json();
  const headers = { ...capability, "x-case-id": session.caseKey };
  assert.equal((await fetch(path, { headers: { ...headers, origin: "https://example.invalid" } })).status, 403);
  assert.equal(calls, 0);
  const response = await fetch(path, { headers });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).models, [{ name: "local:8b" }]);
  assert.equal(calls, 1);
  assert.equal(providers.connection, null);
  unlocked = false;
  assert.equal((await fetch(path, { headers })).status, 401);
  assert.equal(calls, 1);
});
