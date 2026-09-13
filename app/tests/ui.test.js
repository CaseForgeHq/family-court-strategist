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

test("connection screen puts subscription first and never presents disabled preview as available", async (t) => {
  const dom = new JSDOM('<main id="host"></main><div id="modal"></div>');
  const previous = globalThis.document;
  globalThis.document = dom.window.document;
  const document = dom.window.document;
  const inbox = createInbox({ api: async () => ({}), getSession: () => ({ access: { canWrite: true }, claudeCodeEnabled: false, connection: null }), updateSession: () => {},
    showModal: (html) => { document.querySelector("#modal").innerHTML = html; }, closeModal: () => {}, onSaved: () => {} });
  t.after(() => { inbox.unmount(); dom.window.close(); globalThis.document = previous; });
  await inbox.connectionModal();
  assert.equal(document.querySelector("#provider-choice").value, "claude-code");
  assert.equal(document.querySelector("#connect-submit").disabled, true);
  document.querySelector("#provider-choice").value = "anthropic";
  document.querySelector("#provider-choice").dispatchEvent(new dom.window.Event("change"));
  assert.equal(document.querySelector("#provider-key").type, "password");
  assert.equal(document.querySelector("#connect-submit").disabled, false);
});
