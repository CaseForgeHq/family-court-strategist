import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createInbox } from "../public/inbox.js";

function fixture(t, input = {}) {
  const dom = new JSDOM('<div id="modal"></div>');
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  const document = dom.window.document, calls = [];
  globalThis.document = document;
  let session = { caseKey: "fictional-folder", access: { canWrite: true }, connection: null, ...input }, closed = false;
  const inbox = createInbox({
    getSession: () => session,
    updateSession: (value) => { session = value; },
    showModal: (html) => { document.querySelector("#modal").innerHTML = html; },
    closeModal: () => { closed = true; },
    onSaved: () => {},
    api: async (path, options) => {
      calls.push({ path, options });
      assert.equal(path, "/api/providers/connect");
      return { connection: { provider: options.body.provider, model: options.body.model, cloud: options.body.provider === "anthropic" } };
    },
  });
  t.after(() => {
    inbox.unmount(); dom.window.close();
    if (previous) Object.defineProperty(globalThis, "document", previous);
    else delete globalThis.document;
  });
  return { dom, document, calls, inbox, getSession: () => session, isClosed: () => closed };
}

for (const scenario of [
  { name: "active local connection takes precedence over a saved cloud preference", connection: { provider: "ollama", model: "fixture:local" }, saved: "anthropic", expected: "ollama" },
  { name: "active cloud connection takes precedence over a saved local preference", connection: { provider: "anthropic", model: "fixture-cloud" }, saved: "ollama", expected: "anthropic" },
  { name: "saved cloud preference is selected with no active connection", saved: "anthropic", expected: "anthropic" },
  { name: "unknown saved provider falls back to local AI", saved: "unknown-provider", expected: "ollama" },
  { name: "subscription preview cannot be selected through a saved preference", saved: "claude-code", expected: "ollama" },
  { name: "missing preference defaults to local AI", expected: "ollama" },
]) {
  test(`AI form: ${scenario.name}`, async (t) => {
    const { inbox, document, calls } = fixture(t, {
      connection: scenario.connection || null,
      ...(scenario.saved ? { workspacePreferences: { preferredProvider: scenario.saved } } : {}),
    });
    await inbox.connectionModal();
    assert.equal(document.querySelector("#provider-choice").value, scenario.expected);
    assert.deepEqual(calls, [], "Opening the form must not discover, connect or analyse anything");
  });
}

test("a saved cloud preference connects only after an explicit Check connection action", async (t) => {
  const { dom, inbox, document, calls, getSession, isClosed } = fixture(t, {
    workspacePreferences: { preferredProvider: "anthropic", configured: true },
  });
  await inbox.connectionModal();
  assert.equal(document.querySelector("#provider-choice").value, "anthropic");
  assert.deepEqual(calls, []);
  const model = document.querySelector("#provider-model"), key = document.querySelector("#provider-key");
  assert.equal(key.type, "password");
  model.value = "fixture-cloud-model";
  key.value = "synthetic-test-key";
  model.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  key.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  assert.deepEqual(calls, [], "Entering connection details must not send a request");
  document.querySelector("#connect-submit").click();
  for (let i = 0; i < 50 && !isClosed(); i++) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(isClosed(), true);
  assert.deepEqual(calls, [{ path: "/api/providers/connect", options: {
    method: "POST", body: { provider: "anthropic", model: "fixture-cloud-model", apiKey: "synthetic-test-key" },
  } }]);
  assert.equal(key.value, "");
  assert.equal(getSession().connection.provider, "anthropic");
  assert.equal(getSession().workspacePreferences.preferredProvider, "anthropic");
});
