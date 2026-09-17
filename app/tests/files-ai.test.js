import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,realpathSync,rmSync,readdirSync,readFileSync,writeFileSync,existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { FilesAI } from '../lib/files-ai.js';
import { restoreCaseBackup } from '../lib/case-database.js';
import { writeJson,writeNew } from '../lib/files.js';
import { buildCaseModel } from '../lib/vault.js';
import { validateFindings,verifyLaw,fetchOfficialLaw } from '../lib/scan-analysis.js';
const sleep=()=>new Promise(r=>setTimeout(r,10));
async function until(fn) {for(let i=0;i<300;i++){if(await fn())return;await sleep();}throw new Error('Timed out waiting for scan state.');}
function folder(t) {const root=realpathSync(mkdtempSync(join(tmpdir(),'case-files-ai-')));t.after(()=>rmSync(root,{recursive:true,force:true}));return root;}
function result(record) {return {complete:true,summary:'Fictional document summary.',attention:[],findings:[{id:'fixture-fact',kind:'fact',title:'Fixture',detail:'Unique pineapple detail',sources:[]}],laws:[],coverage:{complete:true},model:'gpt-6-astra',effort:'low'};}
function service(t,options={}) {const store=new FilesAI({assertWritable:()=>{},scan:async()=>({}),analyse:async({record})=>result(record),...options});t.after(()=>store.close());return store;}

test('SQLite import preserves originals, deduplicates and never invokes AI until Scan',async t=>{
  const root=folder(t);let calls=0;
  const store=service(t,{analyse:async args=>{calls++;return result(args.record);}});
  const bytes=Buffer.from('A fictional letter in Queensland.'),one=await store.import(root,'letter.txt',bytes);
  assert.equal(calls,0);assert.equal(store.list(root)[0].scan,null);
  assert.deepEqual(readFileSync(join(root,one.document.original)),bytes);
  assert.equal((await store.import(root,'duplicate.txt',bytes)).duplicate,true);
  await store.enqueue(root,one.document.id);await store.tail;
  assert.equal(calls,1);assert.equal((await store.detail(root,one.document.id)).scan.state,'completed');
  assert.equal((await store.detail(root,one.document.id)).reports.length,1);
  assert.ok(existsSync(join(root,'.case-forge/case.sqlite')));
  const found=await store.search(root,'pineapple');assert.equal(found[0].documentId,one.document.id);
  assert.equal(buildCaseModel(root).evidence.length,0);assert.equal(buildCaseModel(root).timeline.length,0);
  await store.close();
});

test('migration verifies hashes and preserves IDs, references, timestamps and legacy reports',async t=>{
  const root=folder(t),bytes=Buffer.from('Fictional legacy content.'),id=createHash('sha256').update(bytes).digest('hex');
  const record={id,reference:'CF-123456789ABC-000041',name:'old.txt',extension:'.txt',bytes:bytes.length,original:`.strategist/documents/${id}/original.txt`,createdAt:'2025-01-01T00:00:00.000Z',status:'review'};
  writeNew(root,record.original,bytes);writeJson(root,`.strategist/documents/${id}/document.json`,record);writeJson(root,`.strategist/documents/${id}/pages.json`,[{page:1,text:bytes.toString()}]);writeJson(root,`.strategist/documents/${id}/draft.json`,{summary:'Old draft',findings:[]});
  const before=readFileSync(join(root,`.strategist/documents/${id}/document.json`));
  const store=service(t);await store.open(root);const detail=(await store.detail(root,id));
  assert.equal(detail.original,record.original);assert.equal(detail.reference,record.reference);assert.equal(detail.createdAt,record.createdAt);assert.equal(detail.scan,null);assert.equal(detail.reports[0].legacy,true);
  assert.deepEqual(readFileSync(join(root,`.strategist/documents/${id}/document.json`)),before);
  await store.close();const reopened=service(t);await reopened.open(root);assert.equal(reopened.list(root).length,1);await reopened.close();
  const corrupt=folder(t);writeNew(corrupt,record.original,Buffer.from('changed'));writeJson(corrupt,`.strategist/documents/${id}/document.json`,record);
  const broken=service(t);await assert.rejects(()=>broken.open(corrupt),/checksum mismatch/);await broken.close();
});

test('three scans maximum across cases, duplicate clicks and Scan next preserve ordering',async t=>{
  const root=folder(t),other=folder(t),releases=[],started=[];let active=0,maximum=0;
  const store=service(t,{analyse:({record,signal})=>new Promise((resolve,reject)=>{active++;maximum=Math.max(maximum,active);started.push(record.name);releases.push(()=>{active--;resolve(result(record));});signal.addEventListener('abort',()=>{active--;reject(signal.reason);},{once:true});})});
  const docs=[];for(let i=0;i<5;i++)docs.push(await store.import(i===4 ? other:root,`doc${i}.txt`,Buffer.from(`fictional record ${i}`)));
  for(let i=0;i<5;i++)await store.enqueue(i===4 ? other:root,docs[i].document.id);
  await until(()=>started.length===3);assert.equal(maximum,3);
  await store.enqueue(root,docs[0].document.id);assert.equal(started.length,3);
  assert.equal((await store.detail(other,docs[4].document.id)).scan.queuePosition,2);
  await store.control(other,docs[4].document.id,'next');releases.shift()();await until(()=>started.length===4);assert.equal(started[3],'doc4.txt');
  while(releases.length)releases.shift()();await until(()=>started.length===5);while(releases.length)releases.shift()();await store.tail;assert.equal(maximum,3);await store.close();
});

test('pause rejects late model output and resume retains checkpoints; rescans retain earlier reports',async t=>{
  const root=folder(t);let finish,attempt=0;
  const store=service(t,{analyse:async({record,checkpoint,saveCheckpoint})=>{attempt++;await saveCheckpoint('Factual read',{factsRead:true});if(attempt===1)await new Promise(resolve=>{finish=resolve;});else assert.equal(checkpoint.factsRead,true);return result(record);}});
  const {document}=await store.import(root,'letter.txt',Buffer.from('Fictional source.'));await store.enqueue(root,document.id);await until(()=>finish);
  await store.control(root,document.id,'pause');finish();await store.tail;assert.equal((await store.detail(root,document.id)).scan.state,'paused');assert.equal((await store.detail(root,document.id)).reports.length,0);
  await store.control(root,document.id,'resume');await store.tail;assert.equal((await store.detail(root,document.id)).scan.state,'completed');
  await store.enqueue(root,document.id,{rescan:true});await store.tail;assert.equal((await store.detail(root,document.id)).reports.length,2);await store.close();
});

test('restart needs explicit resume and a relocated backup preserves usable references',async t=>{
  const root=folder(t),target=folder(t),store=service(t);const {document}=await store.import(root,'file.txt',Buffer.from('Original fixture in Queensland.'));
  const state=await store.open(root);await state.db.call('scan',{job:{id:'interrupted-fixture',documentId:document.id,state:'running',position:1,elapsedMs:0,startedAt:new Date().toISOString(),checkpoint:{extracted:false},jurisdiction:{country:'AU',regions:['QLD']}}});
  await store.close();const next=service(t);await next.open(root);assert.equal((await next.detail(root,document.id)).scan.state,'interrupted');
  const backup=await next.backup(root);restoreCaseBackup(join(root,backup.path),target);await next.close();
  const restored=service(t);await restored.open(target);assert.equal(restored.record(target,document.id).reference,document.reference);assert.equal(readFileSync(join(target,document.original),'utf8'),'Original fixture in Queensland.');await restored.close();
});

test('read-only empty case is not modified; failures never claim complete',async t=>{
  const root=folder(t),readonly=service(t,{getAccess:()=>({canWrite:false}),assertWritable:()=>{throw new Error('Read only');}});await readonly.open(root);assert.deepEqual(readdirSync(root),[]);await readonly.close();
  const other=folder(t),store=service(t,{analyse:async()=>{throw Object.assign(new Error('Sign in with ChatGPT.'),{code:'SCAN_SIGN_IN_REQUIRED'});}});const {document}=await store.import(other,'file.txt',Buffer.from('Fictional fixture.'));await store.enqueue(other,document.id);await store.tail;assert.equal((await store.detail(other,document.id)).scan.state,'sign_in_required');assert.equal((await store.detail(other,document.id)).reports.length,0);await store.close();
});

test('source quotes and contradictions require exact document anchors',()=>{
  const pages=[{page:1,text:'Alex wrote to Sam.',anchor:{kind:'page',page:1,label:'Page 1'}}],value={kind:'claim',title:'Letter',detail:'Alex wrote.',sources:[{page:1,quote:'Alex wrote to Sam.',speaker:'Alex',recipient:'Sam'}]};
  const [finding]=validateFindings([value],pages,'a'.repeat(64));assert.equal(finding.sources[0].recipient,'Sam');assert.equal(finding.sources[0].sourceMatch,'text_match');
  assert.throws(()=>validateFindings([{...value,sources:[{page:2,quote:'Invented'}]}],pages,'a'.repeat(64)),/did not match/);
  assert.throws(()=>validateFindings([{...value,kind:'contradiction'}],pages,'a'.repeat(64)),/two distinct/);
});

test('legal retrieval rejects nonofficial and redirect URLs and flags unverified dates',async()=>{
  await assert.rejects(()=>fetchOfficialLaw({url:'https://attacker.test/law'}),/official/);
  await assert.rejects(()=>fetchOfficialLaw({url:'https://www.legislation.gov.au/act'},{fetchImpl:async()=>new Response(null,{status:302,headers:{location:'http://127.0.0.1/private'}})}),/outside/);
  const source={url:'https://www.legislation.gov.au/test',text:'Fictional Act. Section 1. Exact official provision. Compilation from 2020-01-01 to 2020-12-31.',retrievedAt:'2026-09-17',sha256:'fixture'};
  const law={url:source.url,title:'Fictional Act',provision:'Section 1',text:'Exact official provision.',effectiveFrom:'2020-01-01',effectiveTo:'2020-12-31',versionEvidence:'Compilation from 2020-01-01 to 2020-12-31.'};
  assert.equal(verifyLaw(law,[source],['2020-05-01']).versionStatus,'period_matched_requires_legal_review');
  assert.equal(verifyLaw(law,[source],['2024-05-01']).versionStatus,'needs_date_or_version_review');
});
