import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "../server.js";
import { samplePdf } from "./helpers.js";

test("actual app shell imports documents and saves a journal draft across navigation", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "strategist-shell-"));
  const server = createServer(root, { preview: true });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const dom = new JSDOM(readFileSync(new URL("../public/index.html", import.meta.url), "utf8"), { url: origin, pretendToBeVisual: true });
  const previous = { document: globalThis.document, window: globalThis.window, fetch: globalThis.fetch };
  globalThis.document = dom.window.document; globalThis.window = dom.window;
  globalThis.fetch = (url, options) => previous.fetch(new URL(url, origin), options);
  dom.window.scrollTo = () => {};
  const document = dom.window.document;
  t.after(async () => {
    document.querySelector('[data-view="dashboard"]').click(); // stop inbox polling
    server.inbox.close(); await server.inbox.tail;
    await new Promise((r) => server.close(r));
    dom.window.close(); Object.assign(globalThis, previous);
    rmSync(root, { recursive: true, force: true });
  });
  async function until(check) {
    for (let attempt = 0; attempt < 400; attempt++) {
      if (check()) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.fail(`The app shell did not reach its expected state: ${document.querySelector("#inbox-message")?.textContent || ""}`);
  }
  await import("../public/app.js");
  await until(() => document.querySelector(".intake-shortcut"));
  document.querySelector('[data-view="documents"]').click();
  await until(() => document.querySelector("#document-list").textContent.includes("will appear"));
  const picker = document.querySelector("#document-picker");
  Object.defineProperty(picker, "files", { value: [new File([samplePdf()], "browser-flow.pdf", { type: "application/pdf" })] });
  picker.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  await until(() => document.querySelector("#document-detail").textContent.includes("Ready to analyse"));
  assert.match(document.querySelector("#document-detail").textContent, /browser-flow.pdf/);
  document.querySelector("#ask-claude").click();
  await until(() => document.querySelector("#provider-choice"));
  assert.equal(document.querySelector("#provider-choice").value, "claude-code");
  assert.equal(document.querySelector("#connect-submit").disabled, true);
  document.querySelector("#modal-x").click();
  assert.equal(document.querySelector("#modal-back").hidden, true);
  document.querySelector('[data-view="journal"]').click();
  await until(() => document.querySelector("#journal-list")?.textContent.includes("No journal entries"));
  document.querySelector("#journal-new").click();
  for (const [name, value] of [["title", "A quiet handover"], ["happened", "I arrived and waited outside."], ["reflection", "I felt relieved."]]) {
    const field = document.querySelector(`#journal-form [name="${name}"]`);
    field.value = value;
    field.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  }
  document.querySelector('[data-view="people"]').click();
  document.querySelector('[data-view="journal"]').click();
  await until(() => document.querySelector('#journal-form [name="title"]')?.value === "A quiet handover");
  document.querySelector("#journal-form").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  await until(() => document.querySelector("#journal-edit"));
  assert.match(document.querySelector("#journal-detail").textContent, /A quiet handover/);
  assert.equal(document.querySelector(".journal-reflection").open, false);
  const session = await (await previous.fetch(`${origin}/api/session`)).json();
  const headers = { "x-case-id": session.caseKey };
  const entries = await (await previous.fetch(`${origin}/api/journal`, { headers })).json();
  assert.equal(entries.entries.length, 1);
  assert.doesNotMatch(JSON.stringify(await (await previous.fetch(`${origin}/api/case`)).json()), /quiet handover|felt relieved/);
});
