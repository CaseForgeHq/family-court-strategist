import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
test('desktop case data, session and assets require a main-process capability and an unlocked workspace', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'caseforge-access-')); let unlocked = true;
  const server = createServer(root, { preview: true, desktopToken: 'test-only-capability', isUnlocked: () => unlocked });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(async () => { await new Promise((r) => server.close(r)); rmSync(root, { recursive: true, force: true }); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const path of ['/api/session', '/api/case', '/']) assert.equal((await fetch(origin + path)).status, 401);
  const headers = { 'x-caseforge-desktop': 'test-only-capability' };
  assert.equal((await fetch(origin + '/api/case', { headers })).status, 200);
  for (const path of ['/workspace.css','/workspace-chrome.js','/scene/scene-time.js','/scene/fonts/Ubuntu-Regular.ttf']) {
    assert.equal((await fetch(origin + path)).status,401);
    assert.equal((await fetch(origin + path,{ headers })).status,200);
  }
  unlocked = false;
  assert.equal((await fetch(origin + '/api/case', { headers })).status, 401);
  assert.equal((await fetch(origin + '/api/session', { headers })).status, 401);
});
