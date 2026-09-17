const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } = require('node:fs');
const { join, resolve, sep } = require('node:path');
const { tmpdir } = require('node:os');
const { createScenePreferences } = require('../scene-preferences.cjs');
const locations = [{ id: 'brisbane' }, { id: 'perth' }, { id: 'london' }];
function fixture(t) {
  const root = resolve(tmpdir()), folder = mkdtempSync(join(root, 'caseforge-scene-prefs-'));
  t.after(() => { assert.ok(resolve(folder).startsWith(root + sep + 'caseforge-scene-prefs-')); rmSync(folder, { recursive: true, force: true }); });
  return join(folder, 'scene-preferences.json');
}

test('preferences start from copied defaults and persist only the listed city and boolean setting', (t) => {
  const path = fixture(t), prefs = createScenePreferences(path, locations);
  const defaults = prefs.get(); assert.deepEqual(defaults, { cityId: 'brisbane', weatherEnabled: true });
  defaults.cityId = 'london'; assert.equal(prefs.get().cityId, 'brisbane');
  assert.deepEqual(prefs.set({ cityId: 'perth', weatherEnabled: false, arbitraryUrl: 'https://example.test' }), { cityId: 'perth', weatherEnabled: false });
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), { cityId: 'perth', weatherEnabled: false });
  assert.deepEqual(createScenePreferences(path, locations).get(), { cityId: 'perth', weatherEnabled: false });
});

test('invalid cities and non-boolean weather settings cannot replace saved preferences', (t) => {
  const path = fixture(t), prefs = createScenePreferences(path, locations);
  prefs.set({ cityId: 'perth', weatherEnabled: false }); const original = readFileSync(path);
  for (const value of [null, {}, { cityId: '../config.json', weatherEnabled: true }, { cityId: 'https://example.test', weatherEnabled: true },
    { cityId: '__proto__', weatherEnabled: true }, { cityId: 'Perth', weatherEnabled: true }, { cityId: 'perth', weatherEnabled: 'false' },
    { cityId: 'perth', weatherEnabled: 0 }, { cityId: 'perth' }]) {
    assert.throws(() => prefs.set(value), /listed city/);
    assert.deepEqual(readFileSync(path), original);
  }
});

test('failed writes preserve the saved choice and corrupt stored preferences fall back safely', (t) => {
  const path = fixture(t), prefs = createScenePreferences(path, locations);
  prefs.set({ cityId: 'london', weatherEnabled: false }); const original = readFileSync(path);
  mkdirSync(path + '.tmp');
  assert.throws(() => prefs.set({ cityId: 'perth', weatherEnabled: true }));
  assert.deepEqual(readFileSync(path), original);
  assert.deepEqual(prefs.get(), { cityId: 'london', weatherEnabled: false });
  for (const corrupt of ['{broken', JSON.stringify({ cityId: 'perth', weatherEnabled: 'false' })]) {
    writeFileSync(path, corrupt); assert.deepEqual(prefs.get(), { cityId: 'brisbane', weatherEnabled: true });
  }
});
