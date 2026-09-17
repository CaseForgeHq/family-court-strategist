const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { EventEmitter } = require('node:events');
const { createUpdateMessages, validateMessages } = require('../update-messages.cjs');
const { createUpdates, downloadAndInstall } = require('../updates.cjs');
const entry = version => ({ id: `v${version}`, version, message: `Message ${version}`, publishedAt: '2026-09-17T01:00:00Z' });
const feed = (versions = ['0.14.19','0.14.20']) => ({ schema: 1, latestVersion: versions.at(-1), entries: versions.map(entry) });
test('published history is validated, ordered, and filters already installed versions', () => {
  assert.deepEqual(validateMessages(feed(), '0.14.18').map(e => e.version), ['0.14.20','0.14.19']);
  assert.deepEqual(validateMessages(feed(), '0.14.20'), []);
  for (const invalid of [{}, { ...feed(), entries: [entry('0.14.20'),entry('0.14.20')] }, { ...feed(), entries: [{ ...entry('0.14.20'), publishedAt:'bad' }] }, { ...feed(), entries: [entry('0.14.21')] }]) assert.throws(() => validateMessages(invalid,'0.14.18'));
});
test('static feed requests coalesce, survive offline restart, and reject stale CDN history', async t => {
  const userData = await mkdtemp(join(tmpdir(), 'caseforge-messages-')); t.after(() => rm(userData, { recursive:true,force:true }));
  let body=feed(), count=0, fail=false;
  const fetch = async url => { assert.match(url, /releases\/latest\/download\/update-messages.json/); count++; if(fail) throw Error('offline'); return new Response(JSON.stringify(body)); };
  const messages=createUpdateMessages({ userData,version:'0.14.18',fetch });
  const [a,b]=await Promise.all([messages.refresh(),messages.refresh()]); assert.deepEqual(a,b); assert.equal(count,1);
  body=feed(['0.14.19']); assert.deepEqual(await messages.refresh(),a);
  fail=true; await assert.rejects(messages.refresh());
  assert.deepEqual(await createUpdateMessages({ userData,version:'0.14.19',fetch }).read(),[entry('0.14.20')]);
});
test('new independent messages arrive during download without resetting target or progress', async () => {
  const updater=new EventEmitter(); let resolveDownload, notices=[entry('0.14.19')];
  updater.checkForUpdates=async()=>updater.emit('update-available',{version:'0.14.19',releaseNotes:'Message 0.14.19'});
  updater.downloadUpdate=()=>new Promise(resolve=>{resolveDownload=resolve;});
  const updates=createUpdates({updater,version:'0.14.18',enabled:true,messages:{refresh:async()=>notices}});
  await updates.refreshMessages(); await updates.check(); const pending=updates.download();
  updater.emit('download-progress',{percent:70}); notices=[entry('0.14.20'),entry('0.14.19')]; await updates.refreshMessages();
  assert.equal(updates.status().progress,70); assert.equal(updates.status().version,'0.14.19'); assert.equal(updates.status().notices.length,2);
  updater.emit('update-downloaded',{version:'0.14.19'}); resolveDownload([]); await pending;
  assert.equal(updates.status().phase,'ready'); assert.equal(updates.status().notices.length,2);
});
test('one Download refreshes the target and refuses metadata older than a known published message', async () => {
  const updater=new EventEmitter(); let newest='0.14.19', downloads=0;
  updater.checkForUpdates=async()=>updater.emit('update-available',{version:newest});
  updater.downloadUpdate=async()=>{downloads++;updater.emit('update-downloaded',{version:newest});};
  const updates=createUpdates({updater,version:'0.14.18',enabled:true,messages:{refresh:async()=>[entry('0.14.20'),entry('0.14.19')]}});
  await updates.refreshMessages(); await updates.check(); await downloadAndInstall(updates,()=>{}); assert.equal(downloads,0);
  newest='0.14.20'; let installed=false; await downloadAndInstall(updates,()=>{installed=true;});
  assert.equal(downloads,1); assert.equal(updates.status().version,'0.14.20'); assert.equal(installed,true);
});
test('slow startup cache cannot erase newer fetched messages', async () => {
  let finish; const messages={read:()=>new Promise(resolve=>{finish=resolve;}),refresh:async()=>[entry('0.14.20')]};
  const updates=createUpdates({updater:new EventEmitter(),version:'0.14.18',enabled:true,messages});
  const old=updates.refreshMessages(true); await updates.refreshMessages(); finish([]); await old;
  assert.equal(updates.status().notices[0].version,'0.14.20');
});
