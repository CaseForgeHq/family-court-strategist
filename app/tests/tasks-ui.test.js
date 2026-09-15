import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Tasks } from "../lib/tasks.js";
import { createTasks } from "../public/tasks.js";

async function until(check) {
  for (let n = 0; n < 200; n++) { if (check()) return; await new Promise((r) => setTimeout(r, 5)); }
  assert.fail("Tasks did not reach expected state");
}

test("task UI preserves failed drafts, requires confirmation, records completion and filters closed work", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "tasks-ui-"));
  const store = new Tasks(root, { now: () => new Date("2026-09-15T00:00:00Z") });
  const dom = new JSDOM('<div id="host"></div>', { url: "http://127.0.0.1" });
  const previous = { window: globalThis.window, document: globalThis.document };
  globalThis.window = dom.window; globalThis.document = dom.window.document;
  const host = document.querySelector("#host"), session = { caseKey: "one", access: { canWrite: true } }, calls = [];
  let failOnce = false;
  const ui = createTasks({ getSession: () => session, api: async (path, options = {}) => {
    calls.push(path);
    if (options.method === "POST") {
      if (failOnce) { failOnce = false; throw new Error("Temporary save failure"); }
      return store.save(structuredClone(options.body));
    }
    if (path === "/api/tasks/targets") return { targets: [] };
    if (path === "/api/tasks/journal-targets") return { targets: [] };
    if (path === "/api/tasks") return { ...store.list(), access: session.access };
    return store.get(path.split("/").at(-1));
  } });
  t.after(() => { ui.unmount(); dom.window.close(); Object.assign(globalThis, previous); rmSync(root, { recursive: true, force: true }); });
  const set = (name, value) => {
    const el = host.querySelector(`[name="${name}"]`);
    if (el.type === "checkbox") el.checked = value; else el.value = value;
    el.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  };
  const submit = () => host.querySelector("form").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  await ui.mount(host); host.querySelector("#tasks-new").click();
  set("title", '<img src=x onerror="bad()">'); set("assignee", "Applicant"); set("actor", "Reviewer");
  set("dueDate", "2026-09-15"); assert.equal(host.querySelector('[name="deadlineStatus"]').value, "proposed");
  ui.unmount(); await ui.mount(host);
  assert.equal(host.querySelector('[name="title"]').value, '<img src=x onerror="bad()">');
  set("deadlineStatus", "confirmed"); set("deadlineBasis", "Reviewed my planning date"); set("reminderDate", "2026-09-14");
  submit(); await until(() => host.querySelector("#tasks-message").textContent.includes("tick the deadline confirmation"));
  assert.equal(store.list().entries.length, 0);
  set("confirmDeadline", true); failOnce = true; submit();
  await until(() => host.querySelector("#tasks-message").textContent.includes("Temporary save failure"));
  assert.equal(host.querySelector('[name="title"]').value, '<img src=x onerror="bad()">');
  submit(); await until(() => host.querySelector("#tasks-edit"));
  assert.equal(host.querySelector("img"), null);
  assert.match(host.querySelector("#tasks-list").textContent, /Due today/);
  assert.equal(store.list().counts.reminders, 1);
  host.querySelector("#tasks-edit").click(); set("status", "done"); set("completionNote", "Prepared the copies"); set("reason", "Completed preparation");
  submit(); await until(() => host.querySelector(".journal-history")?.textContent.includes("Version 2"));
  assert.match(host.querySelector("#tasks-list").textContent, /No tasks match/);
  const filter = host.querySelector("#tasks-filter"); filter.value = "done"; filter.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  assert.match(host.querySelector("#tasks-list").textContent, /Completed/);
  assert.equal(store.list().counts.reminders, 0);
  assert.equal(calls.includes("/api/tasks/journal-targets"), false, "journal choices must be opt-in");
  assert.ok(calls.every((p) => p.startsWith("/api/tasks")), "task UI must not contact AI or fact/export endpoints");
});

test("read-only and case switching isolate task drafts", async (t) => {
  const dom = new JSDOM('<div id="host"></div>', { url: "http://127.0.0.1" });
  const previous = { window: globalThis.window, document: globalThis.document };
  globalThis.window = dom.window; globalThis.document = dom.window.document;
  const host = document.querySelector("#host");
  let session = { caseKey: "one", access: { canWrite: true } };
  const ui = createTasks({ getSession: () => session, api: async (path) => path.endsWith("targets") ? { targets: [] } : { entries: [], counts: { review: 0, overdue: 0, today: 0, reminders: 0 }, access: session.access } });
  t.after(() => { ui.unmount(); dom.window.close(); Object.assign(globalThis, previous); });
  await ui.mount(host); host.querySelector("#tasks-new").click();
  const title = host.querySelector('[name="title"]'); title.value = "PRIVATE FIRST CASE"; title.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  ui.unmount(); session = { caseKey: "two", access: { canWrite: false } }; await ui.mount(host);
  assert.equal(host.querySelector("#tasks-new").disabled, true);
  assert.doesNotMatch(host.innerHTML, /PRIVATE FIRST CASE/); assert.equal(host.querySelector("form"), null);
});

test("a source change before confirmation rejects the save and refreshing clears the old confirmation", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "tasks-source-ui-"));
  let source = { id: "note:order.md", title: "Order", kind: "legal", digest: "a".repeat(64) };
  const store = new Tasks(root, { getTargets: () => [source] });
  const dom = new JSDOM('<div id="host"></div>', { url: "http://127.0.0.1" });
  const previous = { window: globalThis.window, document: globalThis.document };
  globalThis.window = dom.window; globalThis.document = dom.window.document;
  const host = document.querySelector("#host"), session = { caseKey: "one", access: { canWrite: true } };
  const ui = createTasks({ getSession: () => session, api: async (path, options = {}) => {
    if (options.method === "POST") return store.save(structuredClone(options.body));
    if (path === "/api/tasks/targets") return { targets: [{ ...source }] };
    if (path === "/api/tasks") return { ...store.list(), access: session.access };
    return store.get(path.split("/").at(-1));
  } });
  t.after(() => { ui.unmount(); dom.window.close(); Object.assign(globalThis, previous); rmSync(root, { recursive: true, force: true }); });
  const set = (name, value) => {
    const el = host.querySelector(`[name="${name}"]`);
    if (el.type === "checkbox") el.checked = value; else el.value = value;
    el.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  };
  await ui.mount(host); host.querySelector("#tasks-new").click();
  for (const [k, v] of Object.entries({ title: "Prepare records", assignee: "Applicant", actor: "Reviewer", sourceId: source.id, dueDate: "2026-09-22", deadlineStatus: "confirmed", deadlineBasis: "Checked my planning date", confirmDeadline: true })) set(k, v);
  source = { ...source, digest: "b".repeat(64) };
  host.querySelector("form").dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
  await until(() => host.querySelector("#tasks-message").textContent.includes("source changed since it was loaded"));
  assert.equal(store.list().entries.length, 0);
  host.querySelector("#tasks-refresh").click();
  await until(() => host.querySelector('[name="confirmDeadline"]').checked === false);
  set("confirmDeadline", true);
  host.querySelector("form").dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
  await until(() => host.querySelector("#tasks-edit"));
  assert.equal(store.list().entries.length, 1);
  assert.equal(store.get(store.list().entries[0].id).revisions[0].content.source.digest, "b".repeat(64));
});
