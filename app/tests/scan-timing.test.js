import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,realpathSync,rmSync,readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FilesAI } from '../lib/files-ai.js';

const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const reader=async()=>({pages:[{page:1,text:'Fictional text.',anchor:{kind:'page',page:1}}],images:[],attachments:[],coverage:{complete:true},reader:{name:'fixture'}});
const report=()=>({complete:true,summary:'Fictional report.',findings:[],laws:[],attention:[],sourcePages:[{page:1,text:'Fictional source.'}],sourceImages:[],coverage:{complete:true}});
const make=options=>new FilesAI({assertWritable:()=>{},scan:async()=>({}),read:reader,analyse:async()=>report(),...options});
async function until(fn){for(let i=0;i<150;i++){if(await fn())return;await wait(10);}throw new Error('Scan test timed out.');}

test('crash recovery uses the last saved processing duration in writable and read-only cases',async t=>{
  const root=realpathSync(mkdtempSync(join(tmpdir(),'case-scan-time-')));let store=make();
  t.after(async()=>{await store.close();rmSync(root,{recursive:true,force:true});});
  const {document}=await store.import(root,'fiction.txt',Buffer.from('Fictional original.'));
  const state=await store.open(root),old='2020-01-01T00:00:00.000Z';
  await state.db.call('scan',{job:{id:'crashed-job',documentId:document.id,state:'running',position:1,startedAt:old,elapsedMs:1200,checkpoint:{orientation:{summary:'Saved reading'}},timingRecordedAt:old}});
  await state.db.call('timing',{id:document.id,jobId:'crashed-job',elapsedMs:6800,recordedAt:old});
  await store.close();
  const before=readFileSync(join(root,'.case-forge/case.sqlite'));
  store=make({getAccess:()=>({canWrite:false})});
  const readonly=await store.detail(root,document.id);
  assert.equal(readonly.scan.state,'interrupted');assert.equal(readonly.scan.elapsedMs,6800);assert.equal(readonly.scan.startedAt,null);
  assert.equal(readonly.scan.timingApproximate,true);assert.match(readonly.scan.error,/excludes app downtime/);
  await store.close();assert.deepEqual(readFileSync(join(root,'.case-forge/case.sqlite')),before);
  store=make();const recovered=await store.detail(root,document.id);
  assert.equal(recovered.scan.elapsedMs,6800);assert.equal(recovered.scan.state,'interrupted');
  const saved=await (await store.open(root)).db.call('getScan',{id:document.id});
  assert.equal(saved.checkpoint.orientation.summary,'Saved reading');assert.equal(saved.startedAt,null);
});

test('heartbeat saves a small timing row, survives lost checkpoint writes, and rejects stale jobs',async t=>{
  const root=realpathSync(mkdtempSync(join(tmpdir(),'case-scan-heartbeat-')));let tick=0,blocked=false,store=make({heartbeatMs:100,monotonicNow:()=>tick,analyse:async({saveCheckpoint,signal})=>{
    await saveCheckpoint('Waiting for fictional model',{large:'Saved checkpoint '.repeat(20000)});blocked=true;
    await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));return report();
  }});
  t.after(async()=>{await store.close();rmSync(root,{recursive:true,force:true});});
  const {document}=await store.import(root,'fiction.txt',Buffer.from('Fictional original.'));
  const state=await store.open(root),originalCall=state.db.call.bind(state.db),calls=[];
  state.db.call=(method,args)=>{calls.push({method,args});return originalCall(method,args);};
  await store.enqueue(root,document.id);await until(()=>blocked);const checkpoints=calls.filter(c=>c.method==='scan').length;
  tick=6200;await until(()=>calls.some(c=>c.method==='timing'&&c.args.elapsedMs===6200));
  await originalCall('getScan',{id:document.id});
  assert.equal(calls.filter(c=>c.method==='scan').length,checkpoints,'Heartbeat must not rewrite the full checkpoint');
  assert.deepEqual(Object.keys(calls.find(c=>c.method==='timing').args).sort(),['elapsedMs','id','jobId','recordedAt']);
  assert.equal(await originalCall('timing',{id:document.id,jobId:'stale-job',elapsedMs:99999999,recordedAt:new Date().toISOString()}),0);
  // End the database first to simulate losing the final pause/checkpoint write.
  await state.db.close();await store.close();
  store=make();const recovered=await store.detail(root,document.id);
  assert.equal(recovered.scan.elapsedMs,6200);assert.equal(recovered.scan.state,'interrupted');
  assert.ok((await (await store.open(root)).db.call('getScan',{id:document.id})).checkpoint.large.length>200000);
});

test('reports receive document-local increasing versions after restart without rewriting earlier sources',async t=>{
  const root=realpathSync(mkdtempSync(join(tmpdir(),'case-report-versions-')));let store=make();
  t.after(async()=>{await store.close();rmSync(root,{recursive:true,force:true});});
  const {document}=await store.import(root,'fiction.txt',Buffer.from('Fictional original.'));
  await store.enqueue(root,document.id);await store.tail;
  const first=(await store.detail(root,document.id)).reports[0],original=JSON.stringify(first);
  assert.equal(first.version,1);assert.equal(first.schemaVersion,1);
  await store.enqueue(root,document.id,{rescan:true});await store.tail;
  assert.deepEqual((await store.detail(root,document.id)).reports.map(r=>r.version),[2,1]);
  await store.close();store=make();await store.enqueue(root,document.id,{rescan:true});await store.tail;
  const all=(await store.detail(root,document.id)).reports;
  assert.deepEqual(all.map(r=>r.version),[3,2,1]);assert.ok(all.every(r=>r.schemaVersion===1));
  assert.equal(JSON.stringify(all.find(r=>r.id===first.id)),original);
  const second=(await store.import(root,'other.txt',Buffer.from('Another fictional original.'))).document;
  await store.enqueue(root,second.id);await store.tail;
  assert.equal((await store.detail(root,second.id)).reports[0].version,1);
});
