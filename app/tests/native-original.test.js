import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../server.js';

test('native opening resolves the registered original and enforces case, token and lock boundaries', async t => {
  const root = mkdtempSync(join(tmpdir(), 'native-original-'));
  let unlocked = true, failure = ''; const opened = [];
  const server = createServer(root, { preview: true, desktopToken: 'test', isUnlocked: () => unlocked,
    openNativeDocument: file => { opened.push(file); return failure; } });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { await new Promise(r => server.close(r)); rmSync(root, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const session = await (await fetch(base + '/api/session', { headers: { 'x-caseforge-desktop': 'test' } })).json();
  const headers = { 'x-caseforge-desktop': 'test', 'x-strategist-token': session.token, 'x-case-id': session.caseKey };
  const imported = await (await fetch(base + '/api/documents?name=fictional.txt', { method: 'POST', headers, body: 'Fictional original.' })).json();
  const url = base + `/api/documents/${imported.document.id}/open-native`;
  assert.equal((await fetch(url, { method: 'POST', headers })).status, 200);
  assert.equal(readFileSync(opened[0], 'utf8'), 'Fictional original.');
  assert.match(opened[0], /\.txt$/);
  assert.equal((await fetch(url, { method: 'POST', headers: { ...headers, 'x-case-id': 'wrong' } })).status, 409);
  assert.equal((await fetch(url, { method: 'POST', headers: { ...headers, 'x-strategist-token': 'wrong' } })).status, 403);
  unlocked = false;
  assert.equal((await fetch(url, { method: 'POST', headers })).status, 401);
  assert.equal(opened.length, 1);
  unlocked = true; failure = 'No association';
  assert.equal((await fetch(url, { method: 'POST', headers })).status, 400);
});

