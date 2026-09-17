import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "../server.js";
import { Providers } from "../lib/providers.js";
import { buildCaseModel } from "../lib/vault.js";
import { createWorkspacePreferences } from "../../desktop/workspace-preferences.cjs";

const folderKey = (folder) => createHash("sha256").update(realpathSync(folder)).digest("hex");

function snapshot(folder) {
  return readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).map((entry) => (
    entry.isDirectory()
      ? { name: entry.name, children: snapshot(join(folder, entry.name)) }
      : { name: entry.name, bytes: readFileSync(join(folder, entry.name)).toString("hex") }
  ));
}

function fixture(t) {
  const temp = realpathSync(tmpdir());
  const scratch = realpathSync(mkdtempSync(join(temp, "caseforge-preferences-test-")));
  const folders = [join(scratch, "Case A"), join(scratch, "Case B")];
  const profilePath = join(scratch, "workspace-preferences.json");
  for (const [index, folder] of folders.entries()) {
    mkdirSync(join(folder, "originals"), { recursive: true });
    writeFileSync(join(folder, "event.md"), `---\nevent_id: EVT-${index + 1}\ndate: 2026-09-01\ntype: event\n---\n# Fictional event ${index + 1}\nOriginal account retained.\n`);
    writeFileSync(join(folder, "originals", "source.bin"), Buffer.from([0, 1, 255, index]));
  }
  const servers = [], calls = { network: 0, connect: 0 };
  const providers = new Providers({ fetchImpl: async () => { calls.network++; throw new Error("Unexpected provider network request"); } });
  t.mock.method(providers, "connect", async () => { calls.connect++; throw new Error("Unexpected provider connection"); });
  t.after(async () => {
    for (const server of servers) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    const resolved = realpathSync(scratch);
    assert.equal(dirname(resolved), temp, "Cleanup must remain directly inside the temporary directory");
    assert.ok(basename(resolved).startsWith("caseforge-preferences-test-"));
    rmSync(resolved, { recursive: true, force: true });
  });
  const start = async (vault, options = {}) => {
    const server = createServer(vault, { preview: true, providers, ...options });
    servers.push(server);
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    return async (path, session) => {
      const response = await fetch(origin + path, session ? {
        method: "POST",
        headers: { "content-type": "application/json", "x-case-id": session.caseKey, "x-strategist-token": session.token },
        body: "{}",
      } : undefined);
      assert.equal(response.status, 200, await response.clone().text());
      return response.json();
    };
  };
  return { folders, profilePath, calls, start };
}

test("saved display names reach case and chronology responses while identity and case bytes stay unchanged", async (t) => {
  const { folders: [folder], profilePath, calls, start } = fixture(t);
  const before = snapshot(folder), originalModel = buildCaseModel(folder);
  const prefs = createWorkspacePreferences(profilePath);
  assert.deepEqual(prefs.get(folder), { folderKey: folderKey(folder), caseName: "Case A", preferredProvider: "ollama", configured: false });
  const request = await start(folder, { getWorkspacePreferences: (root) => prefs.get(root) });
  const initialSession = await request("/api/session");
  assert.equal(initialSession.caseKey, folderKey(folder));
  assert.equal(initialSession.connection, null);
  const saved = prefs.set(folder, { caseName: "Harbour records", preferredProvider: "anthropic" });
  assert.deepEqual(saved, { folderKey: folderKey(folder), caseName: "Harbour records", preferredProvider: "anthropic", configured: true });
  const session = await request("/api/session");
  assert.deepEqual(session.workspacePreferences, saved);
  assert.equal(session.caseKey, initialSession.caseKey, "A display name must not change request scoping");
  assert.equal(session.connection, null, "A saved provider preference must not establish a connection");
  assert.deepEqual(await request("/api/case"), { ...originalModel, caseName: "Harbour records", isSample: false });
  assert.deepEqual(await request("/api/exports/chronology", session), { ...originalModel, caseName: "Harbour records" });
  assert.deepEqual(createWorkspacePreferences(profilePath).get(folder), saved, "Preferences must survive loading a fresh store");
  assert.deepEqual(snapshot(folder), before);
  assert.equal(basename(realpathSync(folder)), "Case A");
  assert.deepEqual(calls, { network: 0, connect: 0 });
});

test("switching folders selects only that folder's display name and preferred provider", async (t) => {
  const { folders, profilePath, calls, start } = fixture(t);
  const before = folders.map(snapshot);
  const prefs = createWorkspacePreferences(profilePath);
  const first = prefs.set(folders[0], { caseName: "Harbour records", preferredProvider: "anthropic" });
  assert.equal(prefs.get(folders[1]).configured, false);
  assert.equal(prefs.get(folders[1]).caseName, "Case B");
  const second = prefs.set(folders[1], { caseName: "Garden records", preferredProvider: "ollama" });
  let active = folders[0];
  const request = await start(() => active, { getWorkspacePreferences: (root) => prefs.get(root) });
  const firstSession = await request("/api/session");
  assert.deepEqual(firstSession.workspacePreferences, first);
  active = folders[1];
  const secondSession = await request("/api/session");
  assert.deepEqual(secondSession.workspacePreferences, second);
  assert.equal(secondSession.caseKey, folderKey(folders[1]));
  assert.notEqual(secondSession.caseKey, firstSession.caseKey);
  assert.equal((await request("/api/case")).caseName, "Garden records");
  assert.equal((await request("/api/exports/chronology", secondSession)).caseName, "Garden records");
  active = folders[0];
  assert.deepEqual((await request("/api/session")).workspacePreferences, first);
  assert.equal((await request("/api/case")).caseName, "Harbour records");
  assert.deepEqual(folders.map(snapshot), before);
  assert.deepEqual(calls, { network: 0, connect: 0 });
});

test("a server without the preference callback retains the original session and model responses", async (t) => {
  const { folders: [folder], calls, start } = fixture(t);
  const before = snapshot(folder), originalModel = buildCaseModel(folder);
  const request = await start(folder);
  const session = await request("/api/session");
  assert.equal(Object.hasOwn(session, "workspacePreferences"), false);
  assert.equal(session.caseKey, folderKey(folder));
  assert.equal(session.connection, null);
  assert.deepEqual(await request("/api/case"), { ...originalModel, isSample: false });
  assert.deepEqual(await request("/api/exports/chronology", session), originalModel);
  assert.deepEqual(snapshot(folder), before);
  assert.deepEqual(calls, { network: 0, connect: 0 });
});
