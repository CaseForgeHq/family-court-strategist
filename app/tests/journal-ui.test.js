import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createJournal } from "../public/journal.js";

async function until(check) {
  for (let n = 0; n < 200; n++) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.fail("Journal did not reach the expected state");
}

test("journal safely renders text, preserves a draft across navigation/errors, saves and shows correction history", async (t) => {
  const dom = new JSDOM('<div id="host"></div>', { url: "http://127.0.0.1" });
  const previous = { window: globalThis.window, document: globalThis.document };
  globalThis.window = dom.window; globalThis.document = dom.window.document;
  const host = document.querySelector("#host"), requests = [];
  let entry = null, fail = true;
  const session = { caseKey: "case-one", access: { canWrite: true } };
  const api = async (path, options = {}) => {
    requests.push({ path, options });
    if (path === "/api/journal/targets") return { targets: [{ id: "note:a.md", kind: "event", title: 'A <script>bad()</script> "title"' }] };
    if (options.method === "POST") {
      if (fail) throw new Error("This entry has a newer version. Your draft is still here.");
      const b = structuredClone(options.body);
      const savedAt = "2026-09-15T08:00:00.000Z";
      entry ||= { id: b.id, recordedAt: savedAt, revisions: [] };
      entry.revisions.push({ revision: b.expectedRevision + 1, savedAt, reason: b.reason, content: { ...b.content, links: b.content.links.map((id) => ({ id, kind: "event", title: "Meeting", available: true })) } });
      return structuredClone(entry);
    }
    if (path === "/api/journal") return { access: session.access, entries: entry ? [{ id: entry.id, ...entry.revisions.at(-1).content, recordedAt: entry.recordedAt, revision: entry.revisions.length }] : [] };
    if (entry && path === `/api/journal/${entry.id}`) return structuredClone(entry);
    throw new Error(`Unexpected path ${path}`);
  };
  const journal = createJournal({ api, getSession: () => session });
  t.after(() => { journal.unmount(); dom.window.close(); Object.assign(globalThis, previous); });
  const input = (name, value) => {
    const node = host.querySelector(`[name="${name}"]`);
    node.value = value;
    node.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  };
  const submit = () => host.querySelector("form").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  await journal.mount(host);
  host.querySelector("#journal-new").click();
  input("title", '<img src=x onerror="bad()">');
  input("reflection", "A private reflection");
  assert.equal(host.querySelector("script"), null);
  const link = host.querySelector('[name="links"]');
  link.checked = true; link.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  journal.unmount(); host.innerHTML = "Another view";
  await journal.mount(host);
  assert.equal(host.querySelector('[name="reflection"]').value, "A private reflection");
  assert.equal(host.querySelector('[name="links"]').checked, true);
  submit();
  await until(() => host.querySelector("#journal-message").textContent.includes("newer version"));
  assert.equal(host.querySelector('[name="reflection"]').value, "A private reflection");
  fail = false; submit();
  await until(() => host.querySelector("#journal-edit"));
  assert.equal(host.querySelector("img"), null);
  assert.equal(host.querySelector(".journal-reflection").open, false);
  assert.equal(entry.revisions.length, 1);
  host.querySelector("#journal-edit").click();
  input("happened", "Updated account"); input("reason", "Remembered the sequence more clearly");
  submit();
  await until(() => host.querySelector(".journal-history")?.textContent.includes("Version 2"));
  assert.equal(entry.revisions[0].content.happened, "");
  assert.equal(entry.revisions[1].content.happened, "Updated account");
  assert.ok(requests.every((r) => r.path.startsWith("/api/journal")), "journal must not call AI, export or fact mutation APIs");
});

test("read-only journal disables creating entries and case switching does not carry a draft", async (t) => {
  const dom = new JSDOM('<div id="host"></div>', { url: "http://127.0.0.1" });
  const previous = { window: globalThis.window, document: globalThis.document };
  globalThis.window = dom.window; globalThis.document = dom.window.document;
  const host = document.querySelector("#host");
  let session = { caseKey: "first", access: { canWrite: true } };
  const journal = createJournal({ getSession: () => session, api: async (p) => p.endsWith("targets") ? { targets: [] } : { entries: [], access: session.access } });
  t.after(() => { journal.unmount(); dom.window.close(); Object.assign(globalThis, previous); });
  await journal.mount(host);
  host.querySelector("#journal-new").click();
  const title = host.querySelector('[name="title"]');
  title.value = "First case private draft"; title.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  journal.unmount();
  session = { caseKey: "second", access: { canWrite: false } };
  await journal.mount(host);
  assert.equal(host.querySelector("#journal-new").disabled, true);
  assert.doesNotMatch(host.innerHTML, /First case private draft/);
  assert.equal(host.querySelector("form"), null);
});
