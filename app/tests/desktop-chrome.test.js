import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const surfaces = [
  { page: "lock", reset: "lock-reset-setup", message: "lock-message", field: "pin" },
  { page: "setup", reset: "setup-reset-app", message: "setup-message", field: "setup-new-pin" },
];
async function until(check) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail("Desktop page did not reach its expected state");
}
function openPage(page, bridge) {
  const html = readFileSync(new URL(`../../desktop/${page}.html`, import.meta.url), "utf8");
  const script = readFileSync(new URL(`../../desktop/${page}.js`, import.meta.url), "utf8");
  const dom = new JSDOM(html, { runScripts: "outside-only" });
  dom.window.strategistDesktop = bridge && page === "setup" ? {
    getWorkspacePreferences: async () => ({ folderKey: "C:/Cases/My Case", caseName: "My Case", preferredProvider: "ollama", configured: false }),
    saveWorkspacePreferences: async (input) => ({ ...input, configured: true }),
    ...bridge,
  } : bridge;
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new dom.window.Event("close")); };
  dom.window.eval(readFileSync(new URL("../../desktop/entry-flow.js", import.meta.url), "utf8"));
  if (page === 'setup') dom.window.eval(readFileSync(new URL("../../desktop/ai-plans.js", import.meta.url), "utf8"));
  dom.window.eval(script);
  return dom;
}
function typePin(document, value) {
  const field = document.getElementById('pin'); field.value = value;
  field.dispatchEvent(new document.defaultView.Event('input', { bubbles: true }));
}

for (const { page, reset, message, field } of surfaces) {
  test(`${page} uses native version and permits recovery when saved setup cannot be read`, async (t) => {
    let finishReset;
    const calls = [];
    const dom = openPage(page, {
      getAppInfo: async () => ({ name: "Case Forge", version: "9.8.7" }),
      securityStatus: async () => ({ error: "Saved setup could not be read." }),
      getSetupState: async () => ({ error: "Saved setup could not be read." }),
      resetAppSetup: async (...args) => { calls.push(args); return await new Promise((resolve) => { finishReset = resolve; }); },
    });
    t.after(() => dom.window.close());
    const document = dom.window.document, button = document.getElementById(reset), status = document.getElementById(message);
    await until(() => status.textContent === "Saved setup could not be read.");
    if (page === "setup") {
      assert.equal(document.getElementById("setup-pin-badge").textContent, "Unavailable");
      assert.equal(document.getElementById("setup-folder-badge").textContent, "Unavailable");
      assert.equal(document.getElementById("setup-pin-card").dataset.status, "error");
    }
    assert.equal(document.querySelector("[data-app-version]").textContent, "Case Forge v9.8.7");
    assert.equal(button.hidden, false);
    assert.equal(button.disabled, false);
    document.getElementById(field).value = "123456";
    button.click(); button.click();
    assert.equal(button.disabled, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].length, 0);
    finishReset({ cancelled: true });
    await until(() => !button.disabled);
    assert.equal(status.textContent, "Saved setup could not be read.");
    assert.equal(document.getElementById(field).value, "123456");
    if (page === "lock") assert.equal(document.getElementById("unlock").disabled, true);
    if (page === "setup") assert.equal(document.querySelectorAll(".setup-card").length, 2);
    button.click(); finishReset({ error: "Reset could not finish." });
    await until(() => !button.disabled);
    assert.equal(status.textContent, "Reset could not finish.");
    button.click(); finishReset({ ok: true });
    await until(() => calls.length === 3);
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(button.disabled, true, "Successful reset waits for the native replacement page");
  });

  for (const mode of ["browser", "missing version API", "failed version API"]) {
    test(`${page} has honest version fallback for ${mode}`, async (t) => {
      const bridge = mode === "browser" ? undefined : {
        securityStatus: async () => ({ configured: true }),
        getSetupState: async () => ({ pinConfigured: false, folderSelected: false }),
        ...(mode === "failed version API" ? { getAppInfo: async () => { throw new Error("Unavailable"); } } : {}),
      };
      const dom = openPage(page, bridge);
      t.after(() => dom.window.close());
      await new Promise((resolve) => setTimeout(resolve, 5));
      assert.equal(dom.window.document.querySelector("[data-app-version]").textContent, mode === "browser" ? "Browser preview" : "Case Forge · version unavailable");
      assert.equal(dom.window.document.getElementById(reset).hidden, true);
    });
  }
}

test('locked folder choice asks for PIN and only uses the authenticated setup route', async (t) => {
  const calls = [];
  const dom = openPage('lock', {
    securityStatus: async () => ({ configured: true }),
    unlock: async () => { calls.push('workspace'); return { ok: true }; },
    unlockToSetup: async (pin, stage) => { calls.push(['setup', pin, stage]); return { error: 'That PIN was not recognised.' }; },
  });
  t.after(() => dom.window.close());
  const document = dom.window.document;
  await until(() => !document.getElementById('pin-form').hidden);
  assert.equal(document.body.dataset.entryStage, 'configure');
  assert.equal(document.querySelectorAll('.entry-card').length, 2);
  document.getElementById('lock-choose-folder').click();
  assert.equal(document.activeElement.id, 'pin');
  assert.equal(calls.length, 0, 'Selecting the folder card must not start a picker or reveal a case');
  typePin(document, '739482');
  document.getElementById('pin-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await until(() => document.getElementById('lock-message').textContent.includes('not recognised'));
  assert.deepEqual(calls, [['setup', '739482', 'configure']]);
  assert.equal(document.getElementById('pin').value, '');
});

test('Enter unlocks once, validates PIN length, and respects the disabled security state', async (t) => {
  let finishUnlock;
  const calls = [];
  const dom = openPage('lock', {
    securityStatus: async () => ({ configured: true }),
    unlockToSetup: async (pin, stage) => { calls.push([pin, stage]); return await new Promise((resolve) => { finishUnlock = resolve; }); },
  });
  t.after(() => dom.window.close());
  const document = dom.window.document, field = document.getElementById('pin');
  const enter = () => field.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await until(() => !document.getElementById('pin-form').hidden && !field.disabled);
  typePin(document, '123'); enter();
  assert.equal(calls.length, 0, 'Invalid-length PIN must not reach the native bridge');
  typePin(document, '739482'); enter(); enter();
  assert.deepEqual(calls, [['739482', 'preferences']], 'Repeated Enter must not submit twice or skip Preferences');
  assert.equal(document.getElementById('lock-choose-folder').disabled, true, 'Busy authentication blocks changing the folder intent');
  assert.equal(document.body.dataset.entryStage, 'configure');
  assert.equal(field.value, '');
  finishUnlock({ error: 'That PIN was not recognised.' });
  await until(() => document.getElementById('lock-message').textContent.includes('not recognised') && !field.disabled);
  typePin(document, '739482'); document.getElementById('unlock').disabled = true; enter();
  document.getElementById('pin-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  assert.equal(calls.length, 1, 'Disabled recovery/throttle state must block submission');
});

test('lock opens directly on two cards with top branding and progress above the cards', async (t) => {
  const dom = openPage('lock', {
    securityStatus: async () => ({ configured: true }),
  });
  t.after(() => dom.window.close());
  const document = dom.window.document;
  await until(() => !document.getElementById('pin-form').hidden && !document.getElementById('pin').disabled);
  assert.equal(document.body.dataset.entryStage, 'configure');
  assert.equal(document.getElementById('configure-stage').hidden, false);
  assert.equal(document.querySelectorAll('.entry-card').length, 2);
  assert.equal(document.querySelector('#welcome-stage, #welcome-continue, #configure-back'), null);
  assert.equal(document.querySelectorAll('body > header .entry-brand img').length, 1);
  assert.equal(document.querySelector('.entry-footer .entry-brand, .entry-footer .setup-progress'), null);
  assert.deepEqual(Array.from(document.querySelectorAll('main > .setup-progress [data-step]'), (item) => item.dataset.step), ['configure', 'preferences', 'ready']);
  assert.equal(document.querySelector('main > .setup-progress').nextElementSibling, document.getElementById('configure-stage'));
  assert.equal(document.querySelector('[aria-current="step"]').dataset.step, 'configure');
  assert.equal(document.getElementById('setup-progress-fill').style.width, '0%');
  assert.equal(document.getElementById('scene-controls').hidden, false);
});

test('native PIN existence and valid typing never claim that an entered PIN was verified', async (t) => {
  let resolveStatus;
  const calls = [];
  const dom = openPage('lock', {
    securityStatus: async () => new Promise(resolve => { resolveStatus = resolve; }),
    unlockToSetup: async (...args) => { calls.push(args); return { error: 'That PIN was not recognised.' }; },
  });
  t.after(() => dom.window.close());
  const document = dom.window.document, card = document.getElementById('lock-pin-card'), badge = document.getElementById('lock-pin-state');
  assert.doesNotMatch(badge.textContent, /^PIN active$/i, 'Unresolved native status must not claim a saved PIN');
  resolveStatus({ configured: true });
  await until(() => /PIN active/i.test(badge.textContent));
  typePin(document, '739');
  assert.equal(card.dataset.status, 'active');
  assert.match(document.getElementById('pin-entry-feedback').textContent, /at least 6/i);
  typePin(document, '739482');
  assert.equal(card.dataset.status, 'ready');
  assert.equal(document.getElementById('pin-entry-feedback').textContent, 'Press Enter to confirm.');
  assert.equal(document.getElementById('lock-message').textContent, '');
  assert.doesNotMatch(card.textContent, /PIN confirmed/i);
  assert.deepEqual(calls, []);
});

test('invalid direct submissions cannot invoke verification and native success is the only confirmed state', async (t) => {
  let verified, finishUnlock;
  const calls = [];
  const dom = openPage('lock', {
    securityStatus: async () => ({ configured: true }),
    onPinVerified: (callback) => { verified = callback; return () => {}; },
    unlockToSetup: async (...args) => { calls.push(args); return new Promise(resolve => { finishUnlock = resolve; }); },
  });
  t.after(() => dom.window.close());
  const document = dom.window.document, card = document.getElementById('lock-pin-card'), form = document.getElementById('pin-form');
  await until(() => !form.hidden && !document.getElementById('pin').disabled);
  assert.equal(typeof verified, 'function'); verified();
  assert.notEqual(card.dataset.status, 'success', 'A stale verification event must not confirm an idle form');
  const submit = () => form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  for (const invalid of ['', '123', '73948x', '7394821111111', '739 482']) {
    typePin(document, invalid); submit();
  }
  assert.deepEqual(calls, [], 'Even programmatic submission must enforce digit format before IPC');
  typePin(document, '739482'); submit(); submit();
  assert.deepEqual(calls, [['739482', 'preferences']]);
  assert.equal(card.dataset.status, 'checking');
  for (const id of ['pin', 'show-pin', 'unlock', 'lock-choose-folder', 'lock-reset-setup']) assert.equal(document.getElementById(id).disabled, true, id + ' must be blocked during verification');
  assert.equal(document.getElementById('pin').value, '');
  assert.doesNotMatch(card.textContent, /PIN confirmed/i);
  assert.equal(typeof verified, 'function'); verified();
  await until(() => card.dataset.status === 'success');
  assert.match(card.textContent, /PIN confirmed/i);
  finishUnlock({ ok: true });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(card.dataset.status, 'success');
  assert.equal(document.getElementById('pin').disabled, true, 'Verified page stays blocked while native navigation completes');
});

test('native throttling blocks PIN, show and folder actions without reporting a confirmed PIN', async (t) => {
  const calls = [];
  const dom = openPage('lock', {
    securityStatus: async () => ({ configured: true, retryAfter: 15 }),
    unlockToSetup: async (...args) => { calls.push(args); return { ok: true }; },
  });
  t.after(() => dom.window.close());
  const document = dom.window.document;
  await until(() => document.getElementById('lock-pin-card').dataset.status === 'waiting');
  assert.match(document.getElementById('lock-message').textContent, /wait.*15/i);
  for (const id of ['pin', 'show-pin', 'unlock', 'lock-choose-folder']) assert.equal(document.getElementById(id).disabled, true);
  typePin(document, '739482');
  document.getElementById('pin-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  assert.deepEqual(calls, []);
  assert.doesNotMatch(document.getElementById('lock-pin-card').textContent, /PIN confirmed/i);
});

for (const [name, bridge] of [['browser preview', undefined], ['unavailable native status', { securityStatus: async () => ({ error: 'Saved setup is unavailable.' }) }], ['unconfigured native status', { securityStatus: async () => ({ configured: false }) }]]) {
  test(name + ' never labels the PIN active or allows verification', async (t) => {
    const dom = openPage('lock', bridge); t.after(() => dom.window.close());
    await new Promise(resolve => setTimeout(resolve, 0));
    const document = dom.window.document;
    assert.doesNotMatch(document.getElementById('lock-pin-state').textContent, /^PIN active$/i);
    assert.equal(document.getElementById('unlock').disabled, true);
    assert.doesNotMatch(document.getElementById('lock-pin-card').textContent, /PIN confirmed/i);
  });
}
