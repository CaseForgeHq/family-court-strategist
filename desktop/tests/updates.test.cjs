const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createUpdates } = require('../updates.cjs');
function fixture() {
  const updater = new EventEmitter(); let checks = 0, downloads = 0, installs = 0;
  updater.checkForUpdates = async () => { checks++; updater.emit('checking-for-update'); updater.emit('update-available', { version: '0.15.0', releaseNotes: 'An update from the team.' }); };
  updater.downloadUpdate = async () => { downloads++; updater.emit('download-progress', { percent: 52 }); updater.emit('update-downloaded', { version: '0.15.0', releaseNotes: 'An update from the team.' }); };
  updater.quitAndInstall = () => installs++;
  return { updater, updates: createUpdates({ updater, version: '0.14.0', enabled: true }), counts: () => ({ checks, downloads, installs }) };
}
test('checks never download or install; explicit download verifies then enables installation', async () => {
  const f = fixture(); assert.equal(f.updater.autoDownload, false); assert.equal(f.updater.autoInstallOnAppQuit, false);
  assert.equal(f.updates.install(), false);
  await f.updates.check(); assert.equal(f.updates.status().phase, 'available'); assert.equal(f.counts().downloads, 0);
  await f.updates.download(); assert.equal(f.updates.status().phase, 'ready'); assert.equal(f.counts().installs, 0);
  await f.updates.check(); assert.equal(f.counts().checks, 1);
  assert.equal(f.updates.install(), true); assert.equal(f.counts().installs, 1); assert.equal(f.updates.install(), false);
});
test('failed download never enables installation and a fresh check can retry', async () => {
  const f = fixture(); f.updater.downloadUpdate = async () => { throw Error('Checksum mismatch'); };
  await f.updates.check(); await f.updates.download(); assert.equal(f.updates.status().phase, 'error'); assert.equal(f.updates.install(), false);
  await f.updates.check(); assert.equal(f.updates.status().phase, 'available');
});
test('development mode does not contact a feed or offer installation', async () => {
  const updates = createUpdates({ updater: null, version: '0.14.0', enabled: false });
  assert.equal((await updates.check()).phase, 'unavailable'); assert.equal((await updates.download()).phase, 'unavailable'); assert.equal(updates.install(), false);
});

test('required policy is strict, survives download failures and clears when current', async () => {
  const f = fixture();
  f.updater.emit('update-available', { version: '0.15.0', caseForgeRequired: 'true' }); assert.equal(f.updates.status().required, false);
  f.updater.emit('update-available', { version: '0.15.0', caseForgeRequired: true }); assert.equal(f.updates.status().required, true);
  f.updater.downloadUpdate = async () => { throw Error('offline'); }; await f.updates.download(); assert.equal(f.updates.status().required, true); assert.equal(f.updates.install(), false);
  f.updater.emit('update-not-available', { version: '0.14.0' }); assert.equal(f.updates.status().required, false);
});
test('overlapping checks and downloads share an operation', async () => {
  const f = fixture(); let complete, count = 0;
  f.updater.checkForUpdates = () => { count++; return new Promise(resolve => { complete = resolve; }); };
  const first = f.updates.check(), second = f.updates.check(); assert.equal(count, 1); complete(); await Promise.all([first, second]);
  f.updater.emit('update-available', { version: '0.15.0' });
  f.updater.downloadUpdate = () => { count++; return new Promise(resolve => { complete = resolve; }); };
  const a = f.updates.download(), b = f.updates.download(); assert.equal(count, 2); complete(); await Promise.all([a, b]);
});

test('install waits for an asynchronous clean close and honours unsaved-work guards', async () => {
  const { closeForUpdate } = require('../updates.cjs');
  for (const blocked of [false, true]) {
    const window = new EventEmitter(); window.webContents = new EventEmitter(); let installs = 0;
    window.close = () => setImmediate(() => blocked ? window.webContents.emit('will-prevent-unload', {}) : window.emit('closed'));
    const result = closeForUpdate(window, () => installs++); assert.equal(installs, 0);
    assert.equal(await result, !blocked); assert.equal(installs, blocked ? 0 : 1);
    assert.equal(window.listenerCount('closed'), 0);
  }
});
