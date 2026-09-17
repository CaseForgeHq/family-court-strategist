const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync, existsSync } = require('node:fs');
const { join, dirname } = require('node:path');
const { tmpdir } = require('node:os');
const { PinSecurity } = require('../security.cjs');
function fixture(t) { const folder = mkdtempSync(join(tmpdir(), 'caseforge-pin-')); t.after(() => rmSync(folder, { recursive: true, force: true })); return join(folder, 'pin.json'); }
test('PIN setup, confirmation and restart require the PIN; plaintext is never stored', (t) => {
  const path = fixture(t), security = new PinSecurity(path);
  assert.equal(security.status().configured, false);
  assert.throws(() => security.setup('739482', '739483'), /match/);
  assert.throws(() => security.setup('123456', '123456'), /predictable/);
  security.setup('739482', '739482');
  assert.doesNotMatch(readFileSync(path, 'utf8'), /739482/);
  assert.throws(() => security.setup('924816', '924816'), /already/);
  assert.throws(() => security.verify('739483'), /not recognised/);
  assert.equal(new PinSecurity(path).verify('739482'), true);
});
test('retry delay persists over restart and rejects even the correct PIN until elapsed', (t) => {
  const path = fixture(t); let now = 100000;
  const security = new PinSecurity(path, { now: () => now }); security.setup('739482', '739482');
  for (let i = 0; i < 5; i++) assert.throws(() => security.verify('999999'));
  const restart = new PinSecurity(path, { now: () => now });
  assert.equal(restart.status().retryAfter, 30);
  assert.throws(() => restart.verify('739482'), /wait/);
  now += 30001; assert.equal(restart.verify('739482'), true); assert.equal(restart.status().retryAfter, 0);
});
test('changing the PIN requires the current PIN and a valid confirmed replacement', (t) => {
  const path = fixture(t), security = new PinSecurity(path);
  security.setup('739482', '739482');
  const original = JSON.parse(readFileSync(path, 'utf8'));
  assert.throws(() => security.change('999999', '924816', '924816'), /not recognised/);
  assert.throws(() => security.change('739482', '924816', '924817'), /match/);
  assert.throws(() => security.change('739482', '123456', '123456'), /predictable/);
  assert.throws(() => security.change('739482', '12345', '12345'), /6 to 12/);
  const retained = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(retained.hash, original.hash);
  assert.equal(retained.salt, original.salt);
  assert.equal(new PinSecurity(path).verify('739482'), true);
  assert.throws(() => security.verify('924816'), /not recognised/);
});

test('a changed PIN survives restart, rejects the old PIN and stores a fresh verifier', (t) => {
  const path = fixture(t), security = new PinSecurity(path);
  security.setup('739482', '739482');
  const original = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(security.change('739482', '924816', '924816'), true);
  const stored = readFileSync(path, 'utf8'), replacement = JSON.parse(stored);
  assert.doesNotMatch(stored, /739482|924816/);
  assert.notEqual(replacement.hash, original.hash);
  assert.notEqual(replacement.salt, original.salt);
  const restart = new PinSecurity(path);
  assert.throws(() => restart.verify('739482'), /not recognised/);
  assert.equal(restart.verify('924816'), true);
});

test('reset forgets the selected folder before removing the PIN and preserves case files', (t) => {
  const path = fixture(t), security = new PinSecurity(path), folder = dirname(path);
  const caseFolder = join(folder, 'My Case'), config = join(folder, 'config.json');
  mkdirSync(caseFolder);
  const sentinel = join(caseFolder, 'saved-evidence.txt');
  const original = Buffer.from('Fictional saved evidence. Preserve this file unchanged.\r\n');
  writeFileSync(sentinel, original);
  writeFileSync(config, JSON.stringify({ vault: caseFolder }));
  security.setup('739482', '739482');
  let callbackCalls = 0;
  assert.equal(security.reset('739482', () => {
    callbackCalls++;
    assert.equal(existsSync(path), true, 'PIN must still exist while clearing remembered location');
    writeFileSync(config, JSON.stringify({ vault: null }));
  }), true);
  assert.equal(callbackCalls, 1);
  assert.equal(existsSync(path), false);
  assert.deepEqual(JSON.parse(readFileSync(config, 'utf8')), { vault: null });
  assert.deepEqual(readFileSync(sentinel), original);
  const restart = new PinSecurity(path);
  assert.deepEqual(restart.status(), { configured: false, retryAfter: 0 });
  assert.throws(() => restart.verify('739482'), /Create your PIN/);
  assert.throws(() => restart.reset('739482'), /Create your PIN/);
  restart.setup('924816', '924816');
  assert.equal(restart.verify('924816'), true);
  assert.throws(() => restart.verify('739482'), /not recognised/);
  assert.deepEqual(readFileSync(sentinel), original);
});

test('incorrect and throttled resets cannot invoke the settings callback or remove the verifier', (t) => {
  const path = fixture(t); let now = 100000, callbackCalls = 0;
  const security = new PinSecurity(path, { now: () => now });
  const beforeRemove = () => { callbackCalls++; };
  security.setup('739482', '739482');
  const original = JSON.parse(readFileSync(path, 'utf8'));
  for (let i = 0; i < 5; i++) assert.throws(() => security.reset('999999', beforeRemove));
  assert.equal(callbackCalls, 0);
  assert.equal(existsSync(path), true);
  const restart = new PinSecurity(path, { now: () => now });
  assert.equal(restart.status().retryAfter, 30);
  assert.throws(() => restart.reset('739482', beforeRemove), /wait/);
  assert.throws(() => restart.change('739482', '924816', '924816'), /wait/);
  assert.equal(callbackCalls, 0);
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).hash, original.hash);
  now += 30001;
  assert.equal(restart.reset('739482', beforeRemove), true);
  assert.equal(callbackCalls, 1);
  assert.equal(existsSync(path), false);
});

test('failure writing settings before reset retains the existing PIN and permits a later retry', (t) => {
  const path = fixture(t), security = new PinSecurity(path);
  const invalidConfigTarget = join(dirname(path), 'config.json');
  mkdirSync(invalidConfigTarget); // A directory cannot be overwritten as a settings file.
  security.setup('739482', '739482');
  const original = JSON.parse(readFileSync(path, 'utf8'));
  let callbackCalls = 0;
  assert.throws(() => security.reset('739482', () => {
    callbackCalls++;
    writeFileSync(invalidConfigTarget, JSON.stringify({ vault: null }));
  }));
  assert.equal(callbackCalls, 1);
  assert.equal(existsSync(path), true);
  const retained = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(retained.hash, original.hash);
  assert.equal(retained.salt, original.salt);
  const restart = new PinSecurity(path);
  assert.equal(restart.status().configured, true);
  assert.equal(restart.verify('739482'), true);
  assert.equal(restart.reset('739482', () => { callbackCalls++; }), true);
  assert.equal(callbackCalls, 2);
  assert.equal(existsSync(path), false);
});

test('corrupted lock settings fail closed for setup, unlock, change and reset', (t) => {
  const path = fixture(t), security = new PinSecurity(path); writeFileSync(path, '{}');
  let callbackCalls = 0;
  assert.throws(() => security.status()); assert.throws(() => security.setup('739482', '739482')); assert.throws(() => security.verify('739482'));
  assert.throws(() => security.change('739482', '924816', '924816'));
  assert.throws(() => security.reset('739482', () => { callbackCalls++; }));
  assert.equal(callbackCalls, 0);
  assert.equal(readFileSync(path, 'utf8'), '{}');
});

test('confirmed setup clearing removes a configured PIN after forgetting the folder and preserves case files', (t) => {
  const path = fixture(t), security = new PinSecurity(path), folder = dirname(path);
  const caseFolder = join(folder, 'Saved Case'), config = join(folder, 'config.json');
  mkdirSync(caseFolder);
  const sentinel = join(caseFolder, 'saved-evidence.txt');
  const original = Buffer.from('Fictional saved case evidence.\r\n');
  writeFileSync(sentinel, original);
  writeFileSync(config, JSON.stringify({ vault: caseFolder }));
  security.setup('739482', '739482');
  let callbackCalls = 0;
  assert.equal(security.clearSetup(() => {
    callbackCalls++;
    assert.equal(existsSync(path), true, 'Forget the folder before removing its app lock');
    writeFileSync(config, JSON.stringify({ vault: null }));
  }), true);
  assert.equal(callbackCalls, 1);
  assert.equal(existsSync(path), false);
  assert.deepEqual(JSON.parse(readFileSync(config, 'utf8')), { vault: null });
  assert.deepEqual(readFileSync(sentinel), original);
  const restart = new PinSecurity(path);
  assert.deepEqual(restart.status(), { configured: false, retryAfter: 0 });
  assert.throws(() => restart.verify('739482'), /Create your PIN/);
  restart.setup('924816', '924816');
  assert.equal(restart.verify('924816'), true);
  assert.throws(() => restart.verify('739482'), /not recognised/);
  assert.deepEqual(readFileSync(sentinel), original);
});

test('confirmed setup clearing recovers from corrupt lock settings without reading a PIN', (t) => {
  for (const corrupt of ['{}', '{invalid JSON']) {
    const path = fixture(t), security = new PinSecurity(path);
    writeFileSync(path, corrupt);
    assert.throws(() => security.status());
    let callbackCalls = 0;
    assert.equal(security.clearSetup(() => {
      callbackCalls++;
      assert.equal(readFileSync(path, 'utf8'), corrupt);
    }), true);
    assert.equal(callbackCalls, 1);
    assert.equal(existsSync(path), false);
    const restart = new PinSecurity(path);
    assert.deepEqual(restart.status(), { configured: false, retryAfter: 0 });
    restart.setup('739482', '739482');
    assert.equal(restart.verify('739482'), true);
  }
});

test('confirmed setup clearing still forgets the folder when no verifier exists and is repeatable', (t) => {
  const path = fixture(t), security = new PinSecurity(path);
  const config = join(dirname(path), 'config.json');
  writeFileSync(config, JSON.stringify({ vault: 'fictional-case-folder' }));
  let callbackCalls = 0;
  for (let i = 0; i < 2; i++) {
    assert.equal(security.clearSetup(() => {
      callbackCalls++;
      writeFileSync(config, JSON.stringify({ vault: null }));
    }), true);
    assert.equal(existsSync(path), false);
    assert.deepEqual(JSON.parse(readFileSync(config, 'utf8')), { vault: null });
    assert.deepEqual(new PinSecurity(path).status(), { configured: false, retryAfter: 0 });
  }
  assert.equal(callbackCalls, 2);
});

test('setup clearing retains exact verifier bytes if forgetting the folder fails', (t) => {
  for (const state of ['configured', 'corrupt', 'missing']) {
    const path = fixture(t), security = new PinSecurity(path);
    if (state === 'configured') security.setup('739482', '739482');
    if (state === 'corrupt') writeFileSync(path, '{invalid JSON');
    const original = existsSync(path) ? readFileSync(path) : null;
    const invalidConfigTarget = join(dirname(path), 'config.json');
    mkdirSync(invalidConfigTarget);
    let callbackCalls = 0;
    assert.throws(() => security.clearSetup(() => {
      callbackCalls++;
      writeFileSync(invalidConfigTarget, JSON.stringify({ vault: null }));
    }));
    assert.equal(callbackCalls, 1);
    assert.equal(existsSync(path), original !== null);
    if (original !== null) assert.deepEqual(readFileSync(path), original);
    if (state === 'configured') assert.equal(new PinSecurity(path).verify('739482'), true);
    if (state === 'corrupt') assert.throws(() => new PinSecurity(path).status());
    assert.equal(security.clearSetup(() => {}), true, 'A later successful settings write permits reset');
    assert.deepEqual(new PinSecurity(path).status(), { configured: false, retryAfter: 0 });
  }
});
