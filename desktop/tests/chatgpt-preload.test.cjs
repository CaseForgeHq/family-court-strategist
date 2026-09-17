'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { runInNewContext } = require('node:vm');

function preload() {
  const ipc = new EventEmitter(), calls = [];
  ipc.invoke = (channel, ...values) => { calls.push({ channel, values }); return Promise.resolve({ ok: true }); };
  ipc.send = () => {};
  let api;
  runInNewContext(readFileSync(join(__dirname, '../preload.cjs'), 'utf8'), {
    require: name => { assert.equal(name, 'electron'); return { ipcRenderer: ipc, contextBridge: { exposeInMainWorld: (_name, value) => { api = value; } } }; },
    window: { addEventListener() {} },
  });
  return { ipc, api, calls };
}

test('preload auth subscription strips event capabilities and private fields and unsubscribes', () => {
  const f = preload(), seen = [];
  const unsubscribe = f.api.onChatGPTStatus(value => seen.push(value));
  f.ipc.emit('chatgpt:status-changed', { sender: 'never expose IPC sender' }, { available: true, connected: true, signingIn: false, busy: false, email: 'fictional@example.invalid', plan: 'plus', state: 'connected', accessToken: 'never-return', authUrl: 'never-return', loginId: 'never-return', activeScans: 2 });
  assert.equal(seen.length, 1); assert.equal(seen[0].email, 'fictional@example.invalid'); assert.equal(seen[0].activeScans, 2);
  assert.doesNotMatch(JSON.stringify(seen), /never-return|sender|accessToken|authUrl|loginId/);
  f.ipc.emit('chatgpt:status-changed', {}, { connected: true }); assert.equal(seen.length, 1);
  unsubscribe(); assert.equal(f.ipc.listenerCount('chatgpt:status-changed'), 0);
  assert.equal(typeof f.api.onChatGPTStatus(null), 'function');
});

test('preload progress accepts only request-bound plain text within the bridge limits', () => {
  const f = preload(), seen = [], requestId = '01a0ad9a-57ba-7a91-8a4a-640f1fc43e29';
  const unsubscribe = f.api.onChatGPTProgress(value => seen.push(value));
  f.ipc.emit('chatgpt:progress', {}, { requestId, phase: 'delta', text: 'Fictional answer', threadId: 'private-thread', prompt: 'private prompt' });
  assert.equal(seen.length, 1); assert.deepEqual(JSON.parse(JSON.stringify(seen[0])), { requestId, phase: 'delta', text: 'Fictional answer' });
  for (const value of [{ requestId, phase: 'tool' }, { requestId: '../private', phase: 'delta' }, { requestId, phase: 'delta', text: 'x'.repeat(128001) }, { requestId, phase: 'delta', text: {} }]) f.ipc.emit('chatgpt:progress', {}, value);
  assert.equal(seen.length, 1); unsubscribe(); assert.equal(f.ipc.listenerCount('chatgpt:progress'), 0);
});

test('preload exposes narrowly named auth cancellation, conversation reset and explicit link actions', async () => {
  const f = preload();
  await f.api.chatGPTCancelLogin(); await f.api.chatGPTNewConversation(); await f.api.chatGPTOpenLink('https://example.invalid/fictional');
  assert.deepEqual(f.calls, [
    { channel: 'chatgpt:cancel-login', values: [] },
    { channel: 'chatgpt:new-conversation', values: [] },
    { channel: 'chatgpt:open-link', values: ['https://example.invalid/fictional'] },
  ]);
});
