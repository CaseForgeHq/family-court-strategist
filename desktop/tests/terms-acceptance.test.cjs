const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { createTermsAcceptance } = require('../terms-acceptance.cjs');
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'caseforge-terms-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, 'terms.json');
  return { root, path, store: createTermsAcceptance(path, () => new Date('2026-09-16T12:00:00Z')) };
}
test('acceptance requires an explicit choice for the exact current document', t => {
  const { store, path } = fixture(t), status = store.get();
  assert.equal(status.accepted, false);
  for (const value of [null, {}, status, { ...status, accepted: 'true' }, { ...status, accepted: true, version: 'old' }, { ...status, accepted: true, documentHash: 'a'.repeat(64) }]) assert.throws(() => store.accept(value), /current beta terms/);
  assert.equal(existsSync(path), false);
  const saved = store.accept({ ...status, accepted: true });
  assert.equal(saved.accepted, true); assert.equal(saved.acceptedAt, '2026-09-16T12:00:00.000Z');
  assert.deepEqual(createTermsAcceptance(path).get(), saved);
  assert.deepEqual(store.accept({ ...status, accepted: true }), saved, 'repeat calls preserve the original timestamp');
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(path))), ['schema', 'version', 'documentHash', 'acceptedAt']);
});
test('old, modified or malformed receipts require acceptance again', t => {
  const { store, path } = fixture(t), status = store.get();
  store.accept({ ...status, accepted: true });
  const receipt = JSON.parse(readFileSync(path));
  for (const change of [{ version: 'old' }, { documentHash: 'b'.repeat(64) }, { schema: 0 }, { acceptedAt: null }, { acceptedAt: 'invalid' }]) {
    writeFileSync(path, JSON.stringify({ ...receipt, ...change })); assert.equal(store.get().accepted, false);
  }
  writeFileSync(path, '{bad'); assert.equal(store.get().accepted, false);
  writeFileSync(path, 'x'.repeat(16385)); assert.equal(store.get().accepted, false);
});
test('failed persistence never reports acceptance and reset removes only the receipt', t => {
  const { root, store, path } = fixture(t), status = store.get();
  mkdirSync(`${path}.tmp`);
  assert.throws(() => store.accept({ ...status, accepted: true })); assert.equal(store.get().accepted, false);
  rmSync(`${path}.tmp`, { recursive: true }); store.accept({ ...status, accepted: true });
  writeFileSync(join(root, 'evidence.txt'), 'Fictional original');
  store.clear(); assert.equal(existsSync(path), false); assert.equal(store.get().accepted, false);
  assert.equal(readFileSync(join(root, 'evidence.txt'), 'utf8'), 'Fictional original');
});
