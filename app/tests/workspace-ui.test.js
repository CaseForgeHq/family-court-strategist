import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const sampleDocuments = {documents:[{id:"a".repeat(64),name:"Meeting letter.txt",reference:"CF-ABCDEF123456-000001",extension:".txt",bytes:50,status:"ready",createdAt:"2026-09-15T12:00:00Z"}],access:{canWrite:true}};
const sampleModel = { caseName: "Example Case", isSample: true, court: "", empty: false,
  stats: { timelineEvents: 1, documentsAnalysed: 0, openContradictions: 0, patternsTracked: 0 },
  timeline: [{ title: "Meeting", date: "2026-09-15", eventId: "EVT-1", type: "event" }], people: [], evidence: [], patterns: [],
  graph: { nodes: [{ id: "meeting.md", label: "Meeting", type: "event", reference: "meeting.md" }], edges: [] },
};
async function until(check) { for (let i = 0; i < 100; i++) { if (check()) return; await new Promise((r) => setTimeout(r, 5)); } assert.fail("Workspace did not finish loading"); }

for (const desktop of [false, true]) test(`workspace navigation and native controls in ${desktop ? "desktop" : "browser"} mode`, async (t) => {
  const dom = new JSDOM(readFileSync(new URL("../public/index.html", import.meta.url), "utf8"), { url: "http://127.0.0.1:4173" });
  const previous = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch };
  const document = dom.window.document, calls = [];
  globalThis.window = dom.window; globalThis.document = document;
  globalThis.fetch = async (path) => ({ ok: true, json: async () => path === "/api/session" ? { caseKey: "case", token: "test", access: { canWrite: true } } : path === "/api/documents" ? sampleDocuments : sampleModel });
  dom.window.scrollTo = () => {};
  if (desktop) dom.window.strategistDesktop = { getAppInfo: async () => ({ name: "Case Forge", version: "9.8.7" }), lock: async () => { calls.push("lock"); }, createCase: async () => { calls.push("new"); return false; }, chooseCaseFolder: async () => { calls.push("choose"); return false; }, getSetupState: async () => ({ pinConfigured: true, folderSelected: true, folderName: "My case", folderPath: "C:/Cases/My case" }), configurePin: async () => ({ ok: true }), resetSession: async () => ({ ok: true }) };
  t.after(() => { dom.window.close(); Object.assign(globalThis, previous); });
  await import(`../public/app.js?workspace-${desktop}`);
  await until(() => document.querySelector('.file-register tbody tr'));
  assert.equal(document.querySelectorAll('.workspace-shortcut,.case-rail').length,0);
  assert.equal(document.querySelectorAll('.file-register tbody tr').length,1);
  assert.match(document.querySelector('.file-register').textContent,/Meeting/);
  assert.ok(document.querySelector('.workspace-nav > [data-view="notebook"]'));
  assert.equal(document.querySelector('[data-view="timeline"]').nextElementSibling.dataset.view,'calendar');
  assert.equal(document.getElementById('context-events').textContent,'1');
  assert.equal(document.querySelector('.home-setup-cards'),null);
  document.querySelector('[data-view="settings"]').click();
  await until(() => document.querySelector(".home-setup-cards"));
  assert.equal(document.querySelector("[data-app-version]").textContent, desktop ? "Case Forge v9.8.7" : "Browser preview");
  assert.equal(document.querySelectorAll(".home-setup-card").length, 2);
  assert.equal(document.querySelectorAll(".home-step,.stats").length, 0);
  assert.equal(document.querySelectorAll('[data-action="reset-session"]').length, 1);
  assert.ok(document.querySelector('.page-purpose [data-action="reset-session"]'));
  assert.equal(document.querySelector(".home-reset-footer"), null);
  assert.equal(document.querySelector('[data-action="configure-pin"]').disabled, !desktop);
  assert.equal(document.querySelector('[data-action="choose-folder"]').disabled, !desktop);
  assert.equal(document.querySelector('[data-action="reset-session"]').disabled, !desktop);
  if (desktop) { await until(() => document.querySelector("#home-folder-path").textContent.includes("C:/Cases")); assert.match(document.querySelector("#home-pin-status").textContent, /PIN configured/); }
  else assert.match(document.querySelector("#home-setup-notice").textContent, /desktop/);
  assert.equal(document.querySelector("#lock-app").hidden, !desktop);
  assert.equal(document.querySelector("#new-case").hidden, !desktop);
  assert.match(document.querySelector("#lock-app").title, /Unsaved drafts will be cleared/);
  assert.match(document.querySelector("#data-banner").textContent, /fictional/i);
  assert.equal(document.querySelector("#search").hidden, false);
  assert.equal(document.querySelector("#ask-claude").hidden, false);
  document.querySelector('[data-view="map"]').click();
  assert.equal(document.querySelector("#view-title").textContent, "Case map");
  assert.equal(document.querySelectorAll(".map-items li").length, 1);
  document.querySelector('[data-view="timeline"]').click();
  assert.equal(document.querySelector("#search").hidden, false);
  document.querySelector('[data-view="patterns"]').click();
  assert.equal(document.querySelector(".more-tools").classList.contains('has-active-page'), true);
  if (desktop) {
    document.querySelector("#lock-app").click();
    document.querySelector("#new-case").click();
    document.querySelector("#current-matter").click();
    assert.equal(document.querySelector("#case-menu").hidden, false);
    document.querySelector('[data-case-action="open"]').click();
    await until(() => calls.length === 3);
    assert.deepEqual(calls, ["lock", "new", "choose"]);
  }
});

test("Workspace settings updates a PIN through the native bridge and requires deliberate session reset confirmation", async (t) => {
  const dom = new JSDOM(readFileSync(new URL("../public/index.html", import.meta.url), "utf8"), { url: "http://127.0.0.1:4173" });
  const previous = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch };
  const document = dom.window.document, pinCalls = [], resetCalls = [];
  globalThis.window = dom.window; globalThis.document = document;
  globalThis.fetch = async (path) => ({ ok: true, json: async () => path === "/api/session" ? { caseKey: "case", access: { canWrite: true } } : path === "/api/documents" ? sampleDocuments : sampleModel });
  dom.window.scrollTo = () => {};
  let rejected = true;
  dom.window.strategistDesktop = {
    getSetupState: async () => ({ pinConfigured: true, folderSelected: true, folderName: '<img src=x onerror="bad()">', folderPath: "C:/Cases/One" }),
    configurePin: async (input) => { pinCalls.push(input); return rejected ? { error: "Current PIN was not recognised." } : { ok: true }; },
    resetSession: async (input) => { resetCalls.push(input); return { ok: true }; },
  };
  t.after(() => { dom.window.close(); Object.assign(globalThis, previous); });
  await import("../public/app.js?home-security");
  await until(() => document.querySelector('.file-register tbody tr'));
  document.querySelector('[data-view="settings"]').click();
  await until(() => document.querySelector("#home-pin-status")?.textContent.includes("PIN configured"));
  assert.equal(document.querySelector("[data-app-version]").textContent, "Case Forge · version unavailable");
  assert.equal(document.querySelectorAll("#view img").length, 0);
  document.querySelector('[data-action="configure-pin"]').click();
  await until(() => document.querySelector("#home-pin-form"));
  const fillPin = () => { document.querySelector("#home-current-pin").value = "873921"; document.querySelector("#home-new-pin").value = "694827"; document.querySelector("#home-confirm-pin").value = "694827"; };
  fillPin(); document.querySelector("#home-pin-form").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  await until(() => document.querySelector("#home-pin-message").textContent.includes("not recognised"));
  assert.equal(document.querySelector("#home-new-pin").value, "");
  assert.equal(document.querySelector("#modal-back").hidden, false);
  rejected = false; fillPin(); document.querySelector("#home-pin-form").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  await until(() => document.querySelector("#modal-back").hidden);
  assert.deepEqual(pinCalls[1], { currentPin: "873921", newPin: "694827", confirmation: "694827" });
  document.querySelector('[data-action="reset-session"]').click();
  await until(() => document.querySelector("#home-reset-form"));
  assert.match(document.querySelector("#modal-body").textContent, /saved case files will stay/);
  assert.match(document.querySelector("#modal-body").textContent, /Unsaved drafts and your AI connection will be cleared/);
  assert.equal(document.querySelector("#reset-confirm").checked, false);
  document.querySelector("#home-reset-form").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  assert.equal(resetCalls.length, 0);
  document.querySelector("#reset-current-pin").value = "694827";
  document.querySelector("#reset-confirm").checked = true;
  document.querySelector("#home-reset-form").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  await until(() => resetCalls.length === 1);
  assert.deepEqual(resetCalls[0], { currentPin: "694827", confirmed: true });
  assert.equal(document.querySelector("#reset-current-pin").value, "");
});


test('people autosave updates one person, persists connections and flushes when closing', async t => {
  const dom = new JSDOM(readFileSync(new URL('../public/index.html', import.meta.url), 'utf8'), { url: 'http://127.0.0.1:4173' });
  const previous = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch };
  globalThis.window = dom.window; globalThis.document = dom.window.document;
  const document = dom.window.document, model = structuredClone(sampleModel), writes = [];
  model.people = [{ name: 'Sam', role: 'Lawyer', reference: 'people/sam.md', notes: '', related: [], revision: 'original' }];
  globalThis.fetch = async (path, options) => ({ ok: true, json: async () => {
    if (path === '/api/session') return { caseKey: 'case', token: 'test', access: { canWrite: true } };
    if (path === '/api/documents') return sampleDocuments;
    if (path === '/api/people') { const input = JSON.parse(options.body); writes.push(input); const saved = { ...input, reference: input.reference || 'people/alex.md', revision: String(writes.length), related: input.connections }; model.people = [...model.people.filter(p => p.reference !== saved.reference), saved]; return saved; }
    return model;
  }});
  dom.window.scrollTo = () => {};
  t.after(() => { dom.window.close(); Object.assign(globalThis, previous); });
  await import('../public/app.js?people-autosave'); await until(() => document.querySelector('.file-register'));
  document.querySelector('[data-view="people"]').click(); document.querySelector('#add-person').click();
  const type = (name, value) => { const input = document.querySelector(`[name="${name}"]`); input.value = value; input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); };
  type('name', 'Alex'); await new Promise(r => setTimeout(r, 800));
  assert.equal(writes.length, 1); assert.equal(model.people.length, 2);
  type('role', 'Parent'); const connection = document.querySelector('[name="connection"]'); connection.checked = true; connection.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  document.querySelector('#modal-x').click(); await until(() => document.querySelector('#modal-back').hidden);
  assert.equal(writes.length, 2); assert.equal(writes[1].reference, 'people/alex.md'); assert.equal(writes[1].expectedRevision, '1');
  assert.deepEqual(writes[1].connections, ['people/sam.md']); assert.equal(model.people.length, 2);
  document.querySelector('[data-edit-person="people/alex.md"]').click();
  assert.equal(document.querySelector('[name="role"]').value, 'Parent'); assert.equal(document.querySelector('[name="connection"]').checked, true);
  document.querySelector('#modal-x').click(); await until(() => document.querySelector('#modal-back').hidden);
});
