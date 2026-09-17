import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createNotebook } from '../public/notebook.js';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

for (const fails of [false, true]) test(`notebook ${fails ? 'failed' : 'successful'} save survives leaving and returning while it is pending`, async t => {
  const dom = new JSDOM('<main></main>', { url: 'http://localhost' });
  const previousWindow = globalThis.window;
  globalThis.window = dom.window;
  const host = dom.window.document.querySelector('main');
  let complete, reject, submitted;
  const notebook = createNotebook({
    getSession: () => ({ caseKey: 'fictional-case', access: { canWrite: true } }),
    api: async (_path, options) => {
      if (!options) return { pages: [] };
      submitted = options.body;
      return new Promise((resolve, fail) => { complete = resolve; reject = fail; });
    }
  });
  t.after(() => { notebook.unmount(); dom.window.close(); globalThis.window = previousWindow; });
  await notebook.mount(host);
  host.querySelector('#notebook-title').value = 'Meeting questions';
  host.querySelector('#notebook-body').value = 'Check the dates.';
  host.querySelector('#notebook-body').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  host.querySelector('#notebook-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  notebook.unmount(); host.replaceChildren();
  await notebook.mount(host);
  assert.equal(host.querySelector('#notebook-body').disabled, true);
  if (fails) reject(new Error('Storage unavailable. Your draft is still here.'));
  else complete({ id: submitted.id, title: submitted.title, body: submitted.body, revision: 1, savedAt: '2026-09-17T02:00:00Z' });
  await tick();
  assert.equal(host.querySelector('#notebook-body').disabled, false);
  assert.equal(host.querySelector('#notebook-body').value, 'Check the dates.');
  assert.match(host.querySelector('#notebook-status').textContent, fails ? /Storage unavailable/ : /Saved on this computer/);
  assert.equal(host.querySelectorAll('[data-notebook-page]').length, fails ? 0 : 1);
});


test('autosave preserves typing during a pending write and persists the newer draft next', async t => {
  const dom = new JSDOM('<main></main>', { url: 'http://localhost' });
  const previousWindow = globalThis.window; globalThis.window = dom.window;
  const host = dom.window.document.querySelector('main'); let complete; const writes = [];
  const notebook = createNotebook({ getSession: () => ({ caseKey: 'case', access: { canWrite: true } }), api: async (_path, options) => {
    if (!options) return { pages: [] };
    writes.push({ ...options.body });
    return new Promise(resolve => { complete = () => resolve({ ...options.body, revision: writes.length, savedAt: new Date().toISOString() }); });
  }});
  t.after(() => { notebook.unmount(); dom.window.close(); globalThis.window = previousWindow; });
  await notebook.mount(host);
  const type = value => { const input = host.querySelector('#notebook-body'); input.value = value; input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); };
  type('First'); await new Promise(r => setTimeout(r, 780)); assert.equal(writes.length, 1);
  type('Second'); complete(); await tick();
  assert.equal(host.querySelector('#notebook-body').value, 'Second');
  await new Promise(r => setTimeout(r, 780)); assert.equal(writes.length, 2);
  assert.equal(writes[1].expectedRevision, 1); assert.equal(writes[1].body, 'Second'); complete(); await tick();
  assert.match(host.querySelector('#notebook-status').textContent, /Saved on this computer/);
});

for (const fails of [false, true]) test(`Blank page waits for pending autosave and ${fails ? 'retains failed draft' : 'saves latest text before opening a fresh page'}`, async t => {
  const dom = new JSDOM('<main></main>', { url: 'http://localhost' });
  const previousWindow = globalThis.window; globalThis.window = dom.window;
  const host = dom.window.document.querySelector('main'), writes = []; let finish;
  const notebook = createNotebook({ getSession: () => ({ caseKey: 'case', access: { canWrite: true } }), api: async (_path, options) => {
    if (!options) return { pages: [] };
    writes.push({ ...options.body });
    if (writes.length === 1) return new Promise((resolve, reject) => { finish = () => fails ? reject(new Error('Disk unavailable')) : resolve({ ...options.body, title: 'Untitled page', revision: 1, savedAt: new Date().toISOString() }); });
    return { ...options.body, title: 'Untitled page', revision: writes.length, savedAt: new Date().toISOString() };
  }});
  t.after(() => { notebook.unmount(); dom.window.close(); globalThis.window = previousWindow; });
  await notebook.mount(host);
  const input = host.querySelector('#notebook-body');
  input.value = 'First'; input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  host.querySelector('#notebook-form').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
  input.value = 'Latest text'; input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  host.querySelector('#notebook-new').click();
  finish(); await tick(); await tick();
  assert.equal(host.querySelector('#notebook-body').value, fails ? 'Latest text' : '');
  assert.equal(host.querySelectorAll('[data-notebook-page]').length, fails ? 0 : 1);
  if (!fails) {
    assert.equal(writes[1].body, 'Latest text');
    host.querySelector('[data-notebook-page]').click(); await tick();
    assert.equal(host.querySelector('#notebook-body').value, 'Latest text');
  }
});
