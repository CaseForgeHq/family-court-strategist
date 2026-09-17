import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeJson, readJson } from '../lib/files.js';

for (const scenario of ['transient', 'persistent', 'other']) test(`atomic JSON save handles ${scenario} Windows rename failures without losing the previous save`, { skip: process.platform !== 'win32' }, t => {
  const root = fs.mkdtempSync(join(tmpdir(), 'caseforge-save-retry-'));
  writeJson(root, 'record.json', { revision: 1 });
  const original = fs.renameSync;
  let attempts = 0;
  t.mock.method(fs, 'renameSync', (source, target) => {
    if (target === join(root, 'record.json')) {
      attempts++;
      if (scenario !== 'transient' || attempts <= 2) {
        assert.deepEqual(readJson(root, 'record.json'), { revision: 1 });
        throw Object.assign(new Error('Simulated file lock'), { code: scenario === 'other' ? 'EINVAL' : 'EPERM' });
      }
    }
    return original(source, target);
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  if (scenario === 'transient') {
    writeJson(root, 'record.json', { revision: 2 });
    assert.equal(attempts, 3);
    assert.deepEqual(readJson(root, 'record.json'), { revision: 2 });
  } else {
    assert.throws(() => writeJson(root, 'record.json', { revision: 2 }), /Simulated file lock/);
    assert.equal(attempts, scenario === 'other' ? 1 : 6);
    assert.deepEqual(readJson(root, 'record.json'), { revision: 1 });
  }
  assert.deepEqual(fs.readdirSync(root), ['record.json']);
});
