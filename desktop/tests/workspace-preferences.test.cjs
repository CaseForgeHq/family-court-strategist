const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync, realpathSync, rmSync } = require('node:fs');
const { join, resolve, sep, basename } = require('node:path');
const { tmpdir } = require('node:os');
const { createHash } = require('node:crypto');
const { createWorkspacePreferences } = require('../workspace-preferences.cjs');

function fixture(t) {
  const temporaryRoot = resolve(tmpdir()), root = mkdtempSync(join(temporaryRoot, 'caseforge-workspace-prefs-'));
  t.after(() => {
    assert.ok(resolve(root).startsWith(temporaryRoot + sep + 'caseforge-workspace-prefs-'));
    rmSync(root, { recursive: true, force: true });
  });
  const path = join(root, 'workspace-preferences.json'), first = join(root, 'First Case'), second = join(root, 'Second Case');
  mkdirSync(first); mkdirSync(second);
  writeFileSync(join(first, 'CASE-DETAILS.md'), '# Original first case\n\nLeave these bytes alone.\r\n');
  writeFileSync(join(second, 'evidence.bin'), Buffer.from([0, 255, 16, 34]));
  const bytes = (folder) => readdirSync(folder).map((name) => [name, readFileSync(join(folder, name)).toString('hex')]);
  const original = [bytes(first), bytes(second)];
  return { root, path, first, second, prefs: createWorkspacePreferences(path), unchanged() {
    assert.deepEqual([bytes(first), bytes(second)], original);
  } };
}

test('the middle plan persists across reopening without accepting client-supplied quotas or entitlements', (t) => {
  const f = fixture(t);
  const saved = f.prefs.set(f.first, { caseName: 'Everyday case', preferredProvider: 'anthropic', aiPlan: 'everyday', advancedIntelligence: false,
    paid: true, dailyInputTokens: 99_000_000, dailyOutputTokens: 99_000_000, monthlyAud: 0 });
  assert.deepEqual(createWorkspacePreferences(f.path).get(f.first), saved);
  assert.equal(saved.aiPlan, 'everyday');
  assert.equal(saved.preferredProvider, 'anthropic');
  const stored = JSON.parse(readFileSync(f.path, 'utf8')).folders[saved.folderKey];
  assert.deepEqual(Object.keys(stored).sort(), ['advancedIntelligence', 'aiPlan', 'caseName', 'preferredProvider']);
  f.unchanged();
});

test('defaults use the real folder identity without creating metadata or touching case files', (t) => {
  const f = fixture(t), value = f.prefs.get(join(f.first, '..', basename(f.first)));
  assert.deepEqual(value, {
    folderKey: createHash('sha256').update(realpathSync(f.first)).digest('hex'),
    caseName: 'First Case', preferredProvider: 'ollama', configured: false,
  });
  value.caseName = 'Changed response';
  assert.equal(f.prefs.get(f.first).caseName, 'First Case');
  assert.equal(existsSync(f.path), false);
  f.unchanged();
});

test('case names and provider preferences persist independently without renaming or editing folders', (t) => {
  const f = fixture(t), firstKey = f.prefs.get(f.first).folderKey;
  const first = f.prefs.set(f.first, { caseName: '  A calmer name  ', preferredProvider: 'anthropic', apiKey: 'must-not-persist', folderKey: 'ignored' });
  assert.deepEqual(first, { folderKey: firstKey, caseName: 'A calmer name', preferredProvider: 'anthropic', configured: true });
  const second = f.prefs.set(f.second, { caseName: 'Separate matter', preferredProvider: 'ollama' });
  assert.notEqual(first.folderKey, second.folderKey);
  const reopened = createWorkspacePreferences(f.path);
  assert.deepEqual(reopened.get(f.first), first); assert.deepEqual(reopened.get(f.second), second);
  f.prefs.set(f.first, { caseName: 'New display name', preferredProvider: 'ollama' });
  assert.deepEqual(reopened.get(f.second), second);
  assert.equal(reopened.get(f.first).folderKey, firstKey);
  const saved = readFileSync(f.path, 'utf8');
  assert.doesNotMatch(saved, /must-not-persist|apiKey|ignored/);
  assert.equal(saved.includes(f.first), false); assert.equal(saved.includes(f.second), false);
  assert.deepEqual(Object.keys(JSON.parse(saved).folders[firstKey]).sort(), ['caseName', 'preferredProvider']);
  assert.equal(basename(f.first), 'First Case'); f.unchanged();
});

test('invalid names, providers and non-directory targets preserve all saved preferences', (t) => {
  const f = fixture(t);
  f.prefs.set(f.first, { caseName: 'First saved', preferredProvider: 'ollama' });
  f.prefs.set(f.second, { caseName: 'Second saved', preferredProvider: 'anthropic' });
  const original = readFileSync(f.path);
  const invalid = [null, [], {}, { caseName: 8, preferredProvider: 'ollama' },
    ...['', '   ', 'a'.repeat(81), 'a\nb', '\tname', 'name\u0000', 'name\u007f', 'name\u0085'].map(caseName => ({ caseName, preferredProvider: 'ollama' })),
    ...[undefined, null, false, 'claude-code', '__proto__', 'https://example.test'].map(preferredProvider => ({ caseName: 'Valid', preferredProvider }))];
  for (const value of invalid) { assert.throws(() => f.prefs.set(f.first, value)); assert.deepEqual(readFileSync(f.path), original); }
  for (const folder of [null, '', join(f.root, 'Missing'), join(f.first, 'CASE-DETAILS.md')]) {
    assert.throws(() => f.prefs.set(folder, { caseName: 'Valid', preferredProvider: 'ollama' }));
    assert.deepEqual(readFileSync(f.path), original);
  }
  assert.equal(f.prefs.set(f.first, { caseName: 'a'.repeat(80), preferredProvider: 'ollama' }).caseName.length, 80);
  f.unchanged();
});

test('corrupt metadata reads as defaults but cannot be overwritten until explicitly cleared', (t) => {
  const f = fixture(t), key = f.prefs.get(f.first).folderKey;
  const corrupt = ['{broken', JSON.stringify({ version: 2, folders: {} }),
    JSON.stringify({ version: 1, folders: { [key]: { caseName: 'Valid', preferredProvider: 'unrecognised' } } }),
    JSON.stringify({ version: 1, folders: { badkey: { caseName: 'Other saved case', preferredProvider: 'ollama' } } })];
  for (const bytes of corrupt) {
    writeFileSync(f.path, bytes);
    assert.equal(f.prefs.get(f.first).configured, false); assert.equal(f.prefs.get(f.first).caseName, 'First Case');
    assert.throws(() => f.prefs.set(f.second, { caseName: 'Replacement', preferredProvider: 'ollama' }), /could not be read/);
    assert.equal(readFileSync(f.path, 'utf8'), bytes);
  }
  assert.equal(f.prefs.clear(), true); assert.equal(existsSync(f.path), false);
  assert.equal(f.prefs.set(f.second, { caseName: 'After reset', preferredProvider: 'ollama' }).configured, true);
  f.unchanged();
});

test('an atomic-write failure retains both previously configured folders', (t) => {
  const f = fixture(t);
  const first = f.prefs.set(f.first, { caseName: 'First saved', preferredProvider: 'anthropic' });
  const second = f.prefs.set(f.second, { caseName: 'Second saved', preferredProvider: 'ollama' });
  const original = readFileSync(f.path);
  mkdirSync(f.path + '.tmp');
  assert.throws(() => f.prefs.set(f.first, { caseName: 'Unwritten', preferredProvider: 'ollama' }));
  assert.deepEqual(readFileSync(f.path), original);
  assert.deepEqual(f.prefs.get(f.first), first); assert.deepEqual(f.prefs.get(f.second), second);
  f.unchanged();
});

test('clear removes only app preference metadata and succeeds when already missing', (t) => {
  const f = fixture(t), other = join(f.root, 'config.json');
  writeFileSync(other, '{"vault":"fictional fixture"}');
  f.prefs.set(f.first, { caseName: 'First saved', preferredProvider: 'ollama' });
  f.prefs.set(f.second, { caseName: 'Second saved', preferredProvider: 'anthropic' });
  writeFileSync(f.path + '.tmp', '{"unfinished":"staged metadata"}');
  assert.equal(f.prefs.clear(), true); assert.equal(f.prefs.clear(), true);
  assert.equal(existsSync(f.path + '.tmp'), false);
  assert.equal(f.prefs.get(f.first).configured, false); assert.equal(f.prefs.get(f.second).configured, false);
  assert.equal(readFileSync(other, 'utf8'), '{"vault":"fictional fixture"}');
  f.unchanged();
});

test('plan previews persist without becoming entitlements or replacing legacy provider choices', (t) => {
  const f = fixture(t);
  const legacy = f.prefs.set(f.first, { caseName: 'Existing setup', preferredProvider: 'anthropic' });
  assert.equal(legacy.aiPlan, undefined);
  const selected = f.prefs.set(f.first, { caseName: 'Existing setup', preferredProvider: 'anthropic',
    aiPlan: 'plus', advancedIntelligence: true, active: true, dailyTokens: 999999999, paid: true, apiKey: 'not-a-secret-fixture' });
  assert.deepEqual(createWorkspacePreferences(f.path).get(f.first), selected);
  assert.equal(selected.aiPlan, 'plus'); assert.equal(selected.advancedIntelligence, true);
  assert.equal(selected.preferredProvider, 'anthropic');
  assert.equal(selected.active, undefined); assert.equal(selected.paid, undefined); assert.equal(selected.dailyTokens, undefined);
  assert.doesNotMatch(readFileSync(f.path, 'utf8'), /apiKey|not-a-secret-fixture|"paid"|"active"|dailyTokens/);
  const bytes = readFileSync(f.path);
  for (const invalid of [
    { aiPlan: '__proto__', advancedIntelligence: false }, { aiPlan: 'enterprise', advancedIntelligence: false },
    { aiPlan: 'plus', advancedIntelligence: 'true' }, { aiPlan: 'free' }, { advancedIntelligence: true },
  ]) {
    assert.throws(() => f.prefs.set(f.first, { caseName: 'Invalid', preferredProvider: 'ollama', ...invalid }));
    assert.deepEqual(readFileSync(f.path), bytes);
  }
  assert.equal(f.prefs.get(f.second).aiPlan, undefined);
  f.unchanged();
});
