import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createInbox } from '../public/inbox.js';

function setup(t, desktop) {
  const dom = new JSDOM('<div id="modal"></div>'), previous = globalThis.document;
  globalThis.document = dom.window.document;
  const inbox = createInbox({ api: async () => { throw new Error('Provider API must not be called'); }, getSession: () => ({ access: { canWrite: true }, workspacePreferences: { preferredProvider: 'anthropic' } }), updateSession: () => {}, desktop: () => desktop, showModal: html => { dom.window.document.querySelector('#modal').innerHTML = html; } });
  t.after(() => { inbox.unmount(); dom.window.close(); globalThis.document = previous; });
  return { inbox, document: dom.window.document };
}

test('scan connection uses ChatGPT only regardless of legacy provider preference', async t => {
  let logins = 0;
  const f = setup(t, { chatGPTStatus: async () => ({ connected: false }), chatGPTLogin: async () => { logins++; return { signingIn: true }; } });
  await f.inbox.connectionModal();
  assert.equal(f.document.querySelector('#provider-choice'), null);
  assert.equal(f.document.querySelector('input[type=password]'), null);
  assert.match(f.document.body.textContent, /GPT-6 Astra.*Low reasoning/);
  assert.equal(logins, 0); f.document.querySelector('#scan-login').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(logins, 1); assert.match(f.document.querySelector('#scan-login-status').textContent, /Finish signing in/);
});

test('connected ChatGPT status is read without starting another login or a scan', async t => {
  const f = setup(t, { chatGPTStatus: async () => ({ connected: true }), chatGPTLogin: async () => { assert.fail('Already connected'); } });
  await f.inbox.connectionModal();
  assert.equal(f.document.querySelector('#scan-login').disabled, true);
  assert.match(f.document.querySelector('#scan-login-status').textContent, /ChatGPT connected/);
});

test('browser preview reports unavailable sign-in without substituting a provider', async t => {
  const f = setup(t); await f.inbox.connectionModal();
  assert.equal(f.document.querySelector('#scan-login').disabled, true);
  assert.match(f.document.querySelector('#scan-login-status').textContent, /desktop app/);
});

test('scan connection immediately follows completed sign-in and cancellation events', async t => {
  let notify, cancelled = 0;
  const f = setup(t, {
    chatGPTStatus: async () => ({ connected: false }),
    chatGPTLogin: async () => ({ connected: false, signingIn: true }),
    chatGPTCancelLogin: async () => { cancelled++; return { connected: false, signingIn: false }; },
    onChatGPTStatus: callback => { notify = callback; return () => {}; },
  });
  await f.inbox.connectionModal();
  assert.match(f.document.querySelector('#scan-login img').src, /monoblossom-white.svg/);
  f.document.querySelector('#scan-login').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(f.document.querySelector('#scan-cancel-login').hidden, false);
  f.document.querySelector('#scan-cancel-login').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(cancelled, 1);
  assert.equal(f.document.querySelector('#scan-login').disabled, false);
  notify({ connected: true, signingIn: false });
  assert.match(f.document.querySelector('#scan-login-status').textContent, /ChatGPT connected/);
  assert.equal(f.document.querySelector('#scan-login').disabled, true);
  assert.equal(f.document.querySelector('#scan-cancel-login').hidden, true);
});
