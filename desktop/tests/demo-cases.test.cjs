const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { createDemoCases } = require('../demo-cases.cjs');
function fixture(generate) {
  const profileDir = mkdtempSync(join(tmpdir(), 'caseforge-demo-registry-'));
  const options = { profileDir, presets: [{ id: 'small', label: 'Small', files: 10 }], generate: generate || (async ({ root, id, size }) => {
    mkdirSync(join(root, '.case-forge')); writeFileSync(join(root, '.case-forge/demo.json'), JSON.stringify({ id, size, fictional: true }));
  }) };
  return { manager: createDemoCases(options), options, profileDir };
}
test('Demos persist independently, can reopen and retain the original case', async () => {
  const { manager, options, profileDir } = fixture();
  const original = join(profileDir, 'Original'); mkdirSync(original); writeFileSync(join(original, 'record.txt'), 'Original');
  const a = await manager.create('small', () => {}), b = await manager.create('small', () => {});
  manager.rememberReturn(original); manager.rememberReturn(a.path);
  assert.equal(manager.returnPath(), original); assert.notEqual(a.path, b.path);
  const restored = createDemoCases(options);
  assert.equal(restored.openPath(a.id), a.path); assert.equal(restored.isDemo(a.path), true); assert.equal(restored.isDemo(original), false);
  assert.equal(restored.status(a.path).entries.find(e => e.id === a.id).current, true);
  assert.equal(readFileSync(join(original, 'record.txt'), 'utf8'), 'Original');
});
test('Arbitrary sizes, paths and unknown IDs are refused', async () => {
  const { manager } = fixture();
  await assert.rejects(manager.create('../original', () => {}), /Choose Small/);
  assert.throws(() => manager.openPath('C:\\Users\\private'), /Choose a saved/);
  assert.throws(() => manager.openPath('11111111-1111-4111-8111-111111111111'), /Choose a saved/);
  assert.equal(manager.status(null).entries.length, 0);
});
test('Incomplete or interrupted demos are never registered', async () => {
  const { manager } = fixture(async () => { throw new Error('Locked'); });
  await assert.rejects(manager.create('small', () => {}), /Locked/);
  assert.equal(manager.status(null).entries.length, 0);
});
test('Corrupt demo registry is not overwritten', async () => {
  const { manager, profileDir } = fixture();
  writeFileSync(join(profileDir, 'demo-cases.json'), '{corrupt');
  await assert.rejects(manager.create('small', () => {}));
  assert.equal(readFileSync(join(profileDir, 'demo-cases.json'), 'utf8'), '{corrupt');
});
