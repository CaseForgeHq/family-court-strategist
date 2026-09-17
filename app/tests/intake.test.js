import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readdirSync,readFileSync,writeFileSync,symlinkSync,existsSync,realpathSync} from 'node:fs';
import {request as httpRequest} from 'node:http';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from '../server.js';
import {buildCaseModel} from '../lib/vault.js';
import {samplePdf} from './helpers.js';
import {FactRegistry} from '../lib/facts.js';
const delay=()=>new Promise(r=>setTimeout(r,10));
async function until(fn){for(let n=0;n<400;n++){if(fn())return;await delay();}throw new Error('Fixture timed out');}
const report=()=>({complete:true,summary:'A fictional record.',attention:[],findings:[],laws:[],model:'gpt-6-astra',effort:'low',coverage:{complete:true}});
async function setup(t,overrides={}) {
  const root=realpathSync(mkdtempSync(join(tmpdir(),'case-intake-'))),calls={count:0};
  const server=createServer(overrides.vaultRef ? ()=>overrides.vaultRef.value || root:root,{preview:true,scanDocument:async()=>({}),analyseDocument:async()=>{calls.count++;return report();},...overrides});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}`,session=await(await fetch(url+'/api/session')).json();
  const request=(path,body,headers={})=>fetch(url+path,{method:body===undefined?'GET':'POST',headers:{'x-case-id':session.caseKey,'x-strategist-token':session.token,'content-type':Buffer.isBuffer(body)?'application/octet-stream':'application/json',...headers},body:body===undefined?undefined:Buffer.isBuffer(body)?body:JSON.stringify(body)});
  const upload=async(bytes=samplePdf(),name='letter.pdf')=>{const response=await request('/api/documents?name='+encodeURIComponent(name),bytes);assert.equal(response.status,201,await response.clone().text());return (await response.json()).document.id;};
  t.after(async()=>{await server.closeWorkspace();server.closeAllConnections();await new Promise(r=>server.close(r));rmSync(root,{recursive:true,force:true});});
  return {root,server,url,session,request,calls,upload};
}
test('import stays local; explicit Scan reads PDF and stores a report without creating case facts',async t=>{
  const {root,server,request,calls,upload}=await setup(t);const original=samplePdf(),id=await upload(original);
  const imported=await(await request(`/api/documents/${id}`)).json();assert.equal(imported.scan,null);assert.deepEqual(imported.pages,[]);assert.equal(calls.count,0);
  assert.deepEqual(readFileSync(join(root,imported.original)),original);
  assert.equal((await request(`/api/documents/${id}/scan`,{})).status,202);await server.inbox.tail;
  const scanned=await(await request(`/api/documents/${id}`)).json();assert.equal(scanned.scan.state,'completed');assert.match(scanned.pages[0].text,/Alex reported/);assert.equal(calls.count,1);
  assert.equal(scanned.reports.length,1);assert.equal(buildCaseModel(root).timeline.length,0);assert.equal(buildCaseModel(root).evidence.length,0);
  assert.equal((await request(`/api/documents/${id}/approve`,{})).status,410);
  assert.deepEqual(Buffer.from(await(await request(`/api/documents/${id}/original`)).arrayBuffer()),original);
  const source=await(await request(`/api/documents/${id}/source?page=1`)).json();assert.equal(source.page,1);assert.match(source.text,/Alex reported/);
});
test('duplicate import retains one original and permanent reference',async t=>{
  const {root,request,upload}=await setup(t),id=await upload(),duplicate=await(await request('/api/documents?name=copy.pdf',samplePdf())).json();
  assert.equal(duplicate.duplicate,true);assert.equal(duplicate.document.id,id);assert.equal(readdirSync(join(root,'.case-forge/originals')).length,1);
});
test('read-only access does not write files and rejects import and export',async t=>{
  const {root,request}=await setup(t,{preview:false});assert.deepEqual((await(await request('/api/documents')).json()).documents,[]);
  assert.equal((await request('/api/documents?name=file.pdf',samplePdf())).status,403);assert.equal((await request('/api/exports/chronology',{})).status,403);assert.deepEqual(readdirSync(root),[]);
});
test('fact API retains reviewed revision boundaries and case isolation',async t=>{
  const {root,request}=await setup(t);writeFileSync(join(root,'source.txt'),'Fictional passage.');
  const fact=new FactRegistry(root).propose({actor:'fixture',statement:'Fictional statement',sources:[{sourceId:'SRC-1',path:'source.txt',locator:'line 1',quote:'Fictional passage.'}]});
  assert.equal((await request('/api/facts',undefined,{'x-case-id':'other'})).status,409);
  assert.equal((await(await request(`/api/facts/${fact.id}`)).json()).revisions[0].status,'PROPOSED');assert.equal((await request(`/api/facts/${fact.id}/verify`,{})).status,404);
});
test('cross-origin, rebinding, missing-token and stale-case requests do not mutate storage',async t=>{
  const {root,request,url}=await setup(t);assert.equal((await request('/api/documents?name=file.pdf',samplePdf(),{origin:'https://attacker.invalid'})).status,403);
  const status=await new Promise((resolve,reject)=>{const req=httpRequest(url+'/api/session',{headers:{host:'attacker.invalid'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();});assert.equal(status,403);
  assert.equal((await request('/api/documents?name=file.pdf',samplePdf(),{'x-strategist-token':''})).status,403);assert.equal((await request('/api/documents?name=file.pdf',samplePdf(),{'x-case-id':'old'})).status,409);assert.deepEqual(readdirSync(root),[]);
});
test('linked storage is rejected without modifying its target',async t=>{
  const {root,request}=await setup(t),outside=mkdtempSync(join(tmpdir(),'case-outside-'));t.after(()=>rmSync(outside,{recursive:true,force:true}));
  try{symlinkSync(outside,join(root,'.case-forge'),'dir');}catch(error){if(error.code==='EPERM')return t.skip('Links unavailable');throw error;}
  assert.equal((await request('/api/documents?name=file.pdf',samplePdf())).status,409);assert.deepEqual(readdirSync(outside),[]);
});
test('invalid PDF is rejected and failed scans never claim completed',async t=>{
  const {request,server,upload}=await setup(t,{analyseDocument:async()=>{throw new Error('Unreadable fictional page.');}});
  assert.equal((await request('/api/documents?name=bad.pdf',Buffer.from('Not PDF'))).status,422);const id=await upload(samplePdf(''));
  await request(`/api/documents/${id}/scan`,{});await server.inbox.tail;const detail=await(await request(`/api/documents/${id}`)).json();assert.equal(detail.scan.state,'failed');assert.deepEqual(detail.reports,[]);
});
test('revoked write access and cancelled scans cannot publish late output',async t=>{
  let writable=true,release;const {root,server,request,upload}=await setup(t,{getAccess:()=>({canWrite:writable}),analyseDocument:()=>new Promise(r=>{release=()=>r(report());})});
  const id=await upload(Buffer.from('Fictional letter.'),'letter.txt');await request(`/api/documents/${id}/scan`,{});await until(()=>release);writable=false;release();await server.inbox.tail;
  const detail=(await server.inbox.detail(root,id));assert.equal(detail.scan.state,'failed');assert.equal(detail.reports.length,0);assert.ok(existsSync(join(root,detail.original)));
  writable=true;release=null;await request(`/api/documents/${id}/retry`,{});await until(()=>release);await request(`/api/documents/${id}/cancel`,{});release();await server.inbox.tail;
  assert.equal((await server.inbox.detail(root,id)).scan.state,'cancelled');assert.equal((await server.inbox.detail(root,id)).reports.length,0);
});
test('changed original is refused before model invocation',async t=>{
  const {root,server,request,calls,upload}=await setup(t),id=await upload();writeFileSync(join(root,server.inbox.record(root,id).original),'Changed outside app');
  await request(`/api/documents/${id}/scan`,{});await server.inbox.tail;assert.equal(calls.count,0);assert.match((await server.inbox.detail(root,id)).scan.error,/original changed/);
});
test('case switching never redirects a scan or includes another document',async t=>{
  const other=realpathSync(mkdtempSync(join(tmpdir(),'case-second-')));t.after(()=>rmSync(other,{recursive:true,force:true}));let submitted,release;
  const vaultRef={value:null},{root,server,request,upload}=await setup(t,{vaultRef,analyseDocument:({record})=>{submitted=record.id;return new Promise(r=>{release=()=>r(report());});}});
  const id=await upload(Buffer.from('Fictional one.'),'one.txt');await upload(Buffer.from('Fictional two.'),'two.txt');await request(`/api/documents/${id}/scan`,{});await until(()=>release);vaultRef.value=other;
  assert.equal((await request('/api/documents')).status,409);release();await server.inbox.tail;assert.equal(submitted,id);assert.deepEqual(readdirSync(other),[]);assert.equal((await server.inbox.detail(root,id)).scan.state,'completed');
});
