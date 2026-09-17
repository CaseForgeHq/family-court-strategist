import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createInbox } from "../public/inbox.js";

async function until(check) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("The interface did not reach its expected state");
}

test("file refresh preserves reading position and keyboard focus, including when a status changes", async t => {
  const dom = new JSDOM('<main id="host"></main>', { url: 'http://127.0.0.1:4322' });
  const previous = globalThis.document;
  globalThis.document = dom.window.document;
  const document = dom.window.document;
  let session = { access: { canWrite: true }, connection: null };
  const documents = Array.from({ length: 20 }, (_, i) => ({ id: String(i + 1).padStart(64, 'a'), reference: `CF-TEST-${i + 1}`, name: `Record ${i + 1}.txt`, extension: '.txt', bytes: 120, status: 'ready', createdAt: '2026-09-17', pages: [] }));
  const inbox = createInbox({ api: async path => path === '/api/documents' ? { documents, access: session.access } : documents.find(item => path.endsWith(item.id)),
    getSession: () => session, updateSession: value => { session = value; }, showModal() {}, closeModal() {}, onSaved() {} });
  t.after(() => { inbox.unmount(); dom.window.close(); globalThis.document = previous; });
  inbox.mount(document.querySelector('#host'));
  await until(() => document.querySelector('.detail-header'));
  const rows = document.querySelector('.register-rows');
  rows.scrollTop = 720;
  document.querySelectorAll('[data-document]')[15].focus();
  const focused = document.activeElement.dataset.document;
  await inbox.refresh();
  assert.equal(document.querySelector('.register-rows'), rows, 'Unchanged polls keep the existing list');
  assert.equal(rows.scrollTop, 720);
  assert.equal(document.activeElement.dataset.document, focused);
  documents[2].status = 'reading';
  await inbox.refresh();
  assert.match(document.querySelector('.register-rows').textContent, /Reading/);
  assert.equal(document.querySelector('.register-rows').scrollTop, 720, 'Updated rows keep the reading position');
  assert.equal(document.activeElement.dataset.document, focused, 'Updated rows keep keyboard focus');
  inbox.unmount(); inbox.mount(document.querySelector('#host'));
  await until(() => document.querySelector('.register-rows'));
  assert.equal(document.querySelector('.register-rows').scrollTop, 0, 'A new mount starts at the top');
});

test("document UI imports a file, requires review, shows sources and saves selected IDs only", async (t) => {
  const dom = new JSDOM('<main id="host"></main><div id="modal"></div>', { url: "http://127.0.0.1:4322" });
  const previous = globalThis.document;
  globalThis.document = dom.window.document;
  const document = dom.window.document, id = "a".repeat(64), calls = [];
  let state = "empty", saved = false;
  let session = { access: { canWrite: true, message: "Development preview" }, connection: { provider: "anthropic", model: "test", cloud: true }, claudeCodeEnabled: true };
  const finding = { id: "finding-1", kind: "event", title: "Reported event", detail: "An attributed event.", date: "2024-03-19", verified: true, issues: [], sources: [{ documentId: id, name: "letter.pdf", page: 1, quote: "A source quote for review.", matched: true }] };
  const draft = { id: "draft-1", summary: "Review this account.", limitations: ["Only this document was reviewed."], findings: [finding, { ...finding, id: "finding-2", title: "Invalid quote", verified: false, issues: ["Quote not matched."] }] };
  const item = () => ({ id, name: "letter.pdf", extension: ".pdf", bytes: 800, pageCount: 1, createdAt: "2026-01-01", updatedAt: state, status: state === "saved" ? "saved" : state === "review" ? "review" : "ready" });
  const api = async (path, options = {}) => {
    calls.push({ path, options });
    if (path === "/api/documents") return { documents: state === "empty" ? [] : [item()], access: session.access };
    if (path.startsWith("/api/documents?")) { state = "ready"; return { document: item(), duplicate: false }; }
    if (path.endsWith("/analyse")) { assert.equal(options.body.consent, true); state = "review"; return { queued: true }; }
    if (path.endsWith("/approve")) {
      assert.deepEqual(options.body, { findingIds: ["finding-1"], draftId: "draft-1" });
      state = "saved"; return {};
    }
    if (path === `/api/documents/${id}`) return { ...item(), pages: [{ page: 1, text: "A source quote for review." }], draft: ["review", "saved"].includes(state) ? draft : null,
      saved: state === "saved" ? { folder: "legal-documents/reviewed", findingIds: ["finding-1"] } : null };
    throw new Error(`Unexpected request: ${path}`);
  };
  const inbox = createInbox({ api, getSession: () => session, updateSession: (value) => { session = value; },
    showModal: (html) => { document.querySelector("#modal").innerHTML = html; }, closeModal: () => {}, onSaved: async () => { saved = true; } });
  t.after(() => { inbox.unmount(); dom.window.close(); globalThis.document = previous; });
  inbox.mount(document.querySelector("#host"));
  await until(() => document.querySelector("#document-list").textContent.includes("will appear"));
  const picker = document.querySelector("#document-picker");
  Object.defineProperty(picker, "files", { value: [new dom.window.File(["PDF fixture"], "letter.pdf", { type: "application/pdf" })] });
  picker.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  await until(() => document.querySelector("#analysis-consent"));
  assert.equal(calls.some((c) => c.path.endsWith("/analyse")), false, "Import must not trigger cloud analysis");
  document.querySelector("#analysis-consent").checked = true;
  document.querySelector('[data-action="analyse"]').click();
  await until(() => document.querySelector('[name="finding"]'));
  assert.equal(document.querySelector('[value="finding-2"]').disabled, true);
  assert.equal(document.querySelector('[value="finding-1"]').checked, false, "Review must never pre-approve findings");
  document.querySelector("[data-source]").click();
  await until(() => document.querySelector(".source-modal"));
  assert.match(document.querySelector(".source-modal").textContent, /source quote/);
  document.querySelector('[value="finding-1"]').checked = true;
  document.querySelector('[data-action="approve"]').click();
  await until(() => document.querySelector(".saved-notice"));
  assert.equal(saved, true);
});

test("connection screen defaults to local AI and never presents disabled subscription preview as available", async (t) => {
  const dom = new JSDOM('<main id="host"></main><div id="modal"></div>');
  const previous = globalThis.document;
  globalThis.document = dom.window.document;
  const document = dom.window.document;
  const inbox = createInbox({ api: async () => ({}), getSession: () => ({ access: { canWrite: true }, claudeCodeEnabled: false, connection: null }), updateSession: () => {},
    showModal: (html) => { document.querySelector("#modal").innerHTML = html; }, closeModal: () => {}, onSaved: () => {} });
  t.after(() => { inbox.unmount(); dom.window.close(); globalThis.document = previous; });
  await inbox.connectionModal();
  assert.equal(document.querySelector("#provider-choice").value, "ollama");
  assert.equal(document.querySelector("#connect-submit").disabled, false);
  document.querySelector("#provider-choice").value = "claude-code";
  document.querySelector("#provider-choice").dispatchEvent(new dom.window.Event("change"));
  assert.equal(document.querySelector("#connect-submit").disabled, true);
  document.querySelector("#provider-choice").value = "anthropic";
  document.querySelector("#provider-choice").dispatchEvent(new dom.window.Event("change"));
  assert.equal(document.querySelector("#provider-key").type, "password");
  assert.equal(document.querySelector("#connect-submit").disabled, false);
});

test("local AI discovery is button-triggered, offers installed models and still requires connection confirmation", async (t) => {
  const dom = new JSDOM('<main id="host"></main><div id="modal"></div>');
  const previous = globalThis.document;
  globalThis.document = dom.window.document;
  const document = dom.window.document, requests = [];
  let session = { caseKey: "one", access: { canWrite: true }, connection: null }, closed = false;
  const inbox = createInbox({ api: async (path, options) => {
    requests.push({ path, options });
    if (path === "/api/providers/local-models") return { available: true, models: [{ name: "local:8b" }], message: "Choose an installed model below." };
    assert.equal(path, "/api/providers/connect");
    assert.deepEqual(options.body, { provider: "ollama", model: "local:8b", apiKey: undefined });
    return { connection: { provider: "ollama", model: "local:8b", cloud: false } };
  }, getSession: () => session, updateSession: (value) => { session = value; },
  showModal: (html) => { document.querySelector("#modal").innerHTML = html; }, closeModal: () => { closed = true; }, onSaved: () => {} });
  t.after(() => { inbox.unmount(); dom.window.close(); globalThis.document = previous; });
  await inbox.connectionModal();
  assert.equal(requests.length, 0, "Opening AI settings must not request model discovery");
  assert.match(document.querySelector("#connection-fields").textContent, /Neither the engine nor a model is included/);
  document.querySelector("#connection-form").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  assert.equal(requests.length, 0, "Missing selection must not call connect");
  assert.match(document.querySelector("#connection-message").textContent, /Find and choose/);
  document.querySelector("#find-local-models").click();
  await until(() => !document.querySelector("#local-model-options").hidden);
  const picker = document.querySelector("#local-model-picker");
  picker.value = "local:8b"; picker.dispatchEvent(new dom.window.Event("change"));
  assert.equal(document.querySelector("#provider-model").value, "local:8b");
  assert.equal(requests.length, 1, "Choosing a model must not connect or analyse anything");
  document.querySelector("#connection-form").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  await until(() => closed);
  assert.equal(session.connection.cloud, false);
  assert.equal(requests.length, 2);
});

test("local discovery handles an absent engine and ignores a late response after changing providers", async (t) => {
  const dom = new JSDOM('<main id="host"></main><div id="modal"></div>');
  const previous = globalThis.document;
  globalThis.document = dom.window.document;
  const document = dom.window.document;
  let resolveModels;
  const inbox = createInbox({ api: async () => new Promise((resolve) => { resolveModels = resolve; }),
    getSession: () => ({ caseKey: "one", access: { canWrite: true }, connection: null }), updateSession: () => {},
    showModal: (html) => { document.querySelector("#modal").innerHTML = html; }, closeModal: () => {}, onSaved: () => {} });
  t.after(() => { inbox.unmount(); dom.window.close(); globalThis.document = previous; });
  await inbox.connectionModal();
  document.querySelector("#find-local-models").click();
  resolveModels({ available: false, models: [], message: "Open or install Ollama and a local model first." });
  await until(() => !document.querySelector("#find-local-models").disabled);
  assert.equal(document.querySelector("#local-model-options").hidden, true);
  assert.match(document.querySelector("#local-models-message").textContent, /Open or install/);
  assert.ok(document.querySelector("#provider-model"), "Manual model-name fallback remains available");
  document.querySelector("#find-local-models").click();
  document.querySelector("#provider-choice").value = "anthropic";
  document.querySelector("#provider-choice").dispatchEvent(new dom.window.Event("change"));
  resolveModels({ available: true, models: [{ name: "local:8b" }], message: "Installed models found" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(document.querySelector("#local-model-picker"), null);
  assert.equal(document.querySelector("#provider-key").type, "password");
  assert.equal(document.querySelector("#provider-model").value, "");
});
