import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { createUpdates } from '../public/updates.js';
const tick = () => new Promise(r => setTimeout(r, 0));
test('hover and keyboard show safe release text; downloading and installing are explicit', async t => {
  const dom = new JSDOM('<button id="open-updates" hidden><span class="update-dot" hidden></span></button>');
  const previous = { window: globalThis.window, document: globalThis.document }; globalThis.window = dom.window; globalThis.document = dom.window.document;
  let downloads = 0, installs = 0;
  const state = { currentVersion: '0.14.0', version: '0.15.0', phase: 'available', message: '<img src=x onerror=alert(1)> Hello from admin.' };
  const desktop = { updateStatus: async () => ({ ...state }), updateDownload: async () => { downloads++; return { ...state, phase: 'ready' }; }, updateInstall: async () => { installs++; return { installed: false }; } };
  t.after(() => { dom.window.dispatchEvent(new dom.window.Event('pagehide')); dom.window.close(); Object.assign(globalThis, previous); });
  createUpdates({ desktop }); await tick(); const trigger = document.getElementById('open-updates');
  trigger.dispatchEvent(new dom.window.Event('pointerenter')); await tick();
  assert.equal(document.getElementById('updates-popover').hidden, false); assert.equal(downloads, 0);
  assert.equal(document.querySelector('.updates-message img'), null); assert.match(document.querySelector('.updates-message p').textContent, /Hello from admin/);
  document.querySelector('[data-update-action]').click(); await tick(); assert.equal(downloads, 1); assert.equal(installs, 0);
  assert.match(document.querySelector('[data-update-action]').textContent, /Restart/);
  document.querySelector('[data-update-action]').click(); await tick(); assert.equal(installs, 1);
  document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' })); assert.equal(document.getElementById('updates-popover').hidden, true);
  assert.equal(document.activeElement, trigger);
});

test('real page mounts one shield trigger and relocates sample data to More tools', () => {
  const dom = new JSDOM(readFileSync(new URL('../public/index.html', import.meta.url), 'utf8'));
  const d = dom.window.document;
  assert.equal(d.querySelectorAll('#open-updates').length, 1);
  assert.equal(d.querySelectorAll('#open-admin').length, 1);
  assert.ok(d.querySelector('.more-tools #open-admin'));
  assert.ok(d.querySelector('#open-updates [data-icon="shield"]'));
  dom.window.close();
});

test('registration uses the same card, announces arrival without focus theft and supports download', async t => {
  const dom = new JSDOM('<input id="name">');
  const previous = { window: globalThis.window, document: globalThis.document }; globalThis.window = dom.window; globalThis.document = dom.window.document;
  t.after(() => { dom.window.dispatchEvent(new dom.window.Event('pagehide')); dom.window.close(); Object.assign(globalThis, previous); });
  document.getElementById('name').focus(); let downloads = 0;
  const state = { currentVersion: '0.14.0', version: '0.15.0', phase: 'available', required: true, message: 'Please update to continue.' };
  createUpdates({ format: 'notification', desktop: { updateStatus: async () => state, updateDownload: async () => { downloads++; return { ...state, phase: 'downloading', progress: 25 }; } } });
  await tick(); const panel = document.getElementById('updates-popover');
  assert.equal(panel.hidden, false); assert.equal(document.activeElement.id, 'name');
  assert.equal(panel.getAttribute('aria-label'), 'Required update message');
  assert.equal(document.querySelector('.updates-message p').textContent, state.message);
  document.querySelector('[data-update-action]').click(); await tick(); assert.equal(downloads, 1); assert.equal(document.querySelector('progress').value, 25);
  document.querySelector('.updates-close').click(); assert.equal(panel.hidden, true);
  document.querySelector('#open-updates').click(); await tick(); assert.equal(panel.hidden, false);
});

test('shield changes on arrival, optional notices open once per version and closing stays dismissed', async t => {
  const dom = new JSDOM('<input id="working"><button id="open-updates"></button>');
  const previous = { window: globalThis.window, document: globalThis.document }; Object.assign(globalThis, { window: dom.window, document: dom.window.document });
  t.after(() => { dom.window.dispatchEvent(new dom.window.Event('pagehide')); dom.window.close(); Object.assign(globalThis, previous); });
  let state = { phase: 'current', currentVersion: '0.14.1', version: '0.14.1' };
  createUpdates({ desktop: { updateStatus: async () => ({ ...state }), updateCheck: async () => ({ ...state }) } }); await tick();
  const trigger = document.getElementById('open-updates'), panel = document.getElementById('updates-popover');
  assert.equal(trigger.classList.contains('has-update'), false); assert.equal(panel.hidden, true);
  document.getElementById('working').focus();
  state = { phase: 'available', currentVersion: '0.14.1', version: '0.15.0', message: 'test', required: false };
  trigger.dispatchEvent(new dom.window.Event('pointerenter')); await tick();
  assert.equal(trigger.classList.contains('has-update'), true); assert.equal(trigger.classList.contains('update-arrival'), true);
  assert.equal(panel.hidden, false); assert.equal(document.activeElement.id, 'working');
  assert.equal(panel.querySelectorAll('button').length, 2); assert.equal(panel.querySelector('header'), null); assert.equal(panel.querySelector('[data-update-action]').textContent, 'Download');
  document.querySelector('.updates-close').click();
  trigger.dispatchEvent(new dom.window.Event('pointerenter')); await tick(); assert.equal(panel.hidden, false); document.querySelector('.updates-close').click(); await tick(); assert.equal(panel.hidden, true);
  state.version = '0.15.1'; trigger.dispatchEvent(new dom.window.Event('pointerenter')); await tick(); assert.equal(panel.hidden, false);
  state = { phase: 'current', currentVersion: '0.15.1', version: '0.15.1' };
  trigger.dispatchEvent(new dom.window.Event('pointerenter')); await tick(); assert.equal(trigger.classList.contains('has-update'), false);
});
