const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { createGoogleCalendar, validateEvents, SCOPE } = require('../google-calendar.cjs');
const safeStorage = {isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(`encrypted:${Buffer.from(s).toString('base64')}`),decryptString:b=>Buffer.from(b.toString().slice(10),'base64').toString()};
function fixture(t,fetchImpl,options={}) {
  const dir=mkdtempSync(join(tmpdir(),'caseforge-google-')); let auth; const opened=[];
  const app=createGoogleCalendar({profileDir:dir,safeStorage,openExternal:async url=>{auth=new URL(url);opened.push(auth);},fetchImpl,...options});
  t.after(()=>{app.close();const full=resolve(dir);assert(full.startsWith(resolve(tmpdir())+require('node:path').sep));assert(full.includes('caseforge-google-'));rmSync(full,{recursive:true,force:true});});
  app.configure({client_id:'123-test.apps.googleusercontent.com',client_secret:'fixture-secret'});
  return {app,dir,opened,get auth(){return auth;}};
}
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
async function login(f) {await f.app.connect();const callback=new URL(f.auth.searchParams.get('redirect_uri'));callback.search=new URLSearchParams({state:f.auth.searchParams.get('state'),code:'fictional-code'}).toString();return fetch(callback);}
test('Google uses loopback, PKCE and exact state; bad state does not exchange tokens',async t=>{
  let calls=0;const f=fixture(t,async()=>{calls++;return json({});});await f.app.connect();
  assert.equal(f.auth.origin,'https://accounts.google.com');assert.equal(f.auth.searchParams.get('scope'),SCOPE);assert.equal(f.auth.searchParams.get('code_challenge_method'),'S256');
  const url=new URL(f.auth.searchParams.get('redirect_uri'));url.search='state=wrong&code=fictional';const reply=await fetch(url);assert.equal(reply.status,400);assert.equal(calls,0);assert.equal(f.app.status().connected,false);
});
test('sign-in stores protected tokens, status omits secrets, selected event sync is idempotent',async t=>{
  const seen=[],ids=new Set();const f=fixture(t,async(url,opts)=>{
    seen.push({url,opts});
    if(url.includes('/token'))return json({access_token:'fake-access',refresh_token:'fake-refresh',expires_in:3600,scope:SCOPE});
    if(url.endsWith('/calendars'))return json({id:'caseforge-calendar'});
    if(url.endsWith('/events')){const data=JSON.parse(opts.body);if(ids.has(data.id))return json({},409);ids.add(data.id);return json(data);}
    return json({ok:true});
  });
  assert.equal((await login(f)).status,200);assert.equal(f.app.status().connected,true);assert.doesNotMatch(JSON.stringify(f.app.status()),/fake-access|fake-refresh|fixture-secret/);assert.doesNotMatch(readFileSync(join(f.dir,'google-calendar.enc'),'utf8'),/fake-access|fake-refresh/);
  const input={caseKey:'a'.repeat(64),events:[{id:'one',title:'Appointment',date:'2026-09-30',details:'Bring notes'}]};
  assert.equal((await f.app.sync(input)).synced.length,1);assert.equal((await f.app.sync(input)).synced.length,1);assert.equal(ids.size,1);
  const body=JSON.parse(seen.find(c=>c.url.endsWith('/events')).opts.body);assert.equal(body.end.date,'2026-10-01');assert.equal(body.visibility,'private');assert(seen.some(c=>c.opts.method==='PATCH'));
});
test('partial Google failures identify failed entries without falsely claiming full sync',async t=>{
  const f=fixture(t,async(url,opts)=>url.includes('/token')?json({access_token:'a',refresh_token:'r',expires_in:3600}):url.endsWith('/calendars')?json({id:'c'}):JSON.parse(opts.body).summary==='Fail'?json({},503):json({ok:true}));
  await login(f);const result=await f.app.sync({caseKey:'b'.repeat(64),events:[{id:'a',title:'Okay',date:'2026-09-01'},{id:'b',title:'Fail',date:'2026-09-02'}]});assert.deepEqual(result.synced,['a']);assert.equal(result.failed[0].id,'b');
});
test('invalid dates and Google client files are rejected before a remote call',t=>{
  const f=fixture(t,async()=>{throw new Error('Unexpected remote call');});assert.throws(()=>f.app.configure({client_id:'https://evil.example',client_secret:'x'}),/Desktop/);
  for(const date of ['2026-02-30','2026-13-01','0000-01-01'])assert.throws(()=>validateEvents([{id:'a',title:'Test',date}]),/invalid/);
  assert.throws(()=>validateEvents([]),/Select/);
});
test('locking cancels the pending callback and disconnect clears saved credentials',async t=>{
  const f=fixture(t,async url=>url.includes('/token')?json({access_token:'a',refresh_token:'r',expires_in:3600}):json({}));await f.app.connect();f.app.close();assert.equal(f.app.status().pending,false);assert.equal(f.app.status().connected,false);await login(f);await f.app.disconnect();assert.equal(f.app.status().connected,false);assert.equal(f.app.status().configured,true);
});
test('non-ASCII callback state is rejected without throwing or exchanging credentials',async t=>{
  let calls=0;const f=fixture(t,async()=>{calls++;return json({});});await f.app.connect();const callback=new URL(f.auth.searchParams.get('redirect_uri'));
  callback.search=new URLSearchParams({state:'é'.repeat(64),code:'fictional'}).toString();const response=await fetch(callback);assert.equal(response.status,400);assert.match(await response.text(),/Invalid sign-in state/);assert.equal(calls,0);assert.equal(f.app.status().pending,true);
});
test('concurrent connection attempts open one browser and a cancelled callback tears down its listener',async t=>{
  const f=fixture(t,async()=>{throw new Error('No token exchange expected');});await Promise.all([f.app.connect(),f.app.connect(),f.app.connect()]);assert.equal(f.opened.length,1);
  const callback=new URL(f.auth.searchParams.get('redirect_uri'));callback.search=new URLSearchParams({state:f.auth.searchParams.get('state'),error:'access_denied'}).toString();const response=await fetch(callback);assert.equal(response.status,400);assert.match(await response.text(),/cancelled/);assert.equal(f.app.status().pending,false);assert.equal(f.app.status().connected,false);
  await assert.rejects(fetch(callback,{signal:AbortSignal.timeout(1000)}));
});
test('successful callback body completes and timeout/browser-open failures close pending state',async t=>{
  const f=fixture(t,async()=>json({access_token:'a',refresh_token:'r',expires_in:3600}));const response=await login(f);assert.equal(response.status,200);assert.match(await response.text(),/Connected/);assert.equal(f.app.status().pending,false);
  const timed=fixture(t,async()=>json({}),{timeoutMs:30});await timed.app.connect();await new Promise(r=>setTimeout(r,60));assert.equal(timed.app.status().pending,false);assert.match(timed.app.status().message,/timed out/);
  const failed=fixture(t,async()=>json({}),{openExternal:async()=>{throw new Error('Browser unavailable');}});await assert.rejects(failed.app.connect(),/Could not open/);assert.equal(failed.app.status().pending,false);
});
test('expired access tokens refresh once, keep protected refresh credentials and report failed remote revocation',async t=>{
  const grants=[];const f=fixture(t,async(url,options)=>{
    if(url.endsWith('/token')){const params=new URLSearchParams(options.body);grants.push(params.get('grant_type'));return params.get('grant_type')==='authorization_code'?json({access_token:'old',refresh_token:'retained',expires_in:-1}):json({access_token:'new',expires_in:3600});}
    if(url.endsWith('/revoke'))return json({},503);
    if(url.endsWith('/calendars'))return json({id:'calendar'});return json({});
  });await login(f);await f.app.sync({caseKey:'c'.repeat(64),events:[{id:'one',title:'Fictional meeting',date:'2026-09-22'}]});assert.deepEqual(grants,['authorization_code','refresh_token']);
  const state=JSON.parse(safeStorage.decryptString(readFileSync(join(f.dir,'google-calendar.enc'))));assert.equal(state.tokens.refresh_token,'retained');assert.equal(state.tokens.access_token,'new');
  const disconnected=await f.app.disconnect();assert.equal(disconnected.connected,false);assert.match(disconnected.message,/Google Account/);
});
test('locking aborts an active sync and prevents a late conflict from starting a PATCH',async t=>{
  let release,activeSignal,patches=0;const f=fixture(t,async(url,options)=>{
    if(url.endsWith('/token'))return json({access_token:'a',refresh_token:'r',expires_in:3600});if(url.endsWith('/calendars'))return json({id:'calendar'});
    if(options.method==='PATCH'){patches++;return json({});}
    activeSignal=options.signal;return new Promise(resolve=>{release=resolve;});
  });await login(f);const value={caseKey:'d'.repeat(64),events:[{id:'one',title:'Fictional',date:'2026-09-22'}]},running=f.app.sync(value);
  while(!release)await new Promise(r=>setTimeout(r,1));await assert.rejects(f.app.sync(value),/already running/);await assert.rejects(f.app.connect(),/current Google operation/);
  f.app.close();assert.equal(activeSignal.aborted,true);release(json({},409));await assert.rejects(running,/locked/);assert.equal(patches,0);assert.equal(f.app.status().connected,true,'Lock retains the encrypted account connection');
});
test('disconnect during token exchange cannot save late credentials',async t=>{
  let release,signal;const f=fixture(t,async(url,options)=>{signal=options.signal;return new Promise(resolve=>{release=resolve;});});await f.app.connect();const callback=new URL(f.auth.searchParams.get('redirect_uri'));callback.search=new URLSearchParams({state:f.auth.searchParams.get('state'),code:'fictional'}).toString();const pendingResponse=fetch(callback).catch(()=>null);
  while(!release)await new Promise(r=>setTimeout(r,1));await f.app.disconnect();assert.equal(signal.aborted,true);release(json({access_token:'late',refresh_token:'late-refresh',expires_in:3600}));await pendingResponse;await new Promise(r=>setTimeout(r,5));assert.equal(f.app.status().connected,false);assert.match(f.app.status().message,/Disconnected/);
});
test('duplicate selections and an all-day date beyond the supported end-date range are rejected',()=>{
  const e={id:'same',title:'Fictional',date:'2026-09-22'};assert.throws(()=>validateEvents([e,e]),/once/);assert.throws(()=>validateEvents([{...e,date:'9999-12-31'}]),/invalid/);assert.throws(()=>validateEvents([{...e,id:''}]),/invalid/);
});
test('locking immediately after connect does not leave its listen promise or callback alive',async t=>{
  const f=fixture(t,async()=>json({}));const connecting=f.app.connect();f.app.close();
  await assert.rejects(Promise.race([connecting,new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Listen did not settle')),500);timer.unref?.();})]),/locked/);assert.equal(f.app.status().pending,false);
});
