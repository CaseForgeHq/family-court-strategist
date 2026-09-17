import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,realpathSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FilesAI } from '../lib/files-ai.js';
import { createServer } from '../server.js';

const pages=[
  {page:1,text:'Amber school meeting was recorded.',anchor:{kind:'paragraph',paragraph:1}},
  {page:2,text:'Cobalt expenses were recorded.',anchor:{kind:'cell',sheet:'Budget',row:4,column:2,cell:'B4'}},
  {page:3,text:'Indigo response was recorded.',anchor:{kind:'timestamp',startMs:125000,endMs:129000}}
];
const read=async()=>({pages,images:[],attachments:[],coverage:{complete:true},reader:{name:'fictional reader'}});
const analyse=async({checkpoint,saveCheckpoint})=>{
  await saveCheckpoint('Fictional review',{readText:'Saved reading checkpoint. '.repeat(10000)});
  return {complete:true,summary:checkpoint.rescanMarker || 'First vermilion report.',findings:[],laws:[],attention:[],sourcePages:pages,sourceImages:[],coverage:{complete:true}};
};

test('opening SQLite cases loads metadata only; detail and resumed jobs hydrate on demand',async t=>{
  const root=realpathSync(mkdtempSync(join(tmpdir(),'case-sqlite-lazy-')));
  let store=new FilesAI({assertWritable:()=>{},scan:async()=>({}),read,analyse});
  t.after(async()=>{await store.close();rmSync(root,{recursive:true,force:true});});
  const {document}=await store.import(root,'fictional.txt',Buffer.from('Fictional original.'));
  await store.enqueue(root,document.id);await store.tail;
  const first=(await store.detail(root,document.id)).reports[0];
  await store.close();
  let resumed=false;
  store=new FilesAI({assertWritable:()=>{},scan:async()=>({}),read,analyse:async args=>{resumed=true;assert.ok(args.checkpoint.readText.length>200000);return analyse(args);}});
  const state=await store.open(root);
  assert.equal(state.extractions.size,0);assert.equal(state.reports.size,0);
  assert.equal(state.jobs.get(document.id).checkpoint,undefined);
  assert.equal(state.reportSummaries.get(document.id)[0].summary,undefined);
  const loaded=await store.detail(root,document.id);
  assert.equal(loaded.pages[1].anchor.cell,'B4');assert.equal(loaded.reports[0].id,first.id);
  assert.equal(state.extractions.size,0);assert.equal(state.reports.size,0,'Reading a detail does not retain whole reports in the case cache');
  const job=await state.db.call('getScan',{id:document.id});
  job.state='paused';await state.db.call('scan',{job});state.jobs.set(document.id,{...state.jobs.get(document.id),state:'paused'});
  await store.control(root,document.id,'resume');await store.tail;
  assert.equal(resumed,true);assert.equal((await store.detail(root,document.id)).reports.length,2);
});

test('main search uses SQLite across pages, retains source anchors and report history, and binds consent to saved content',async t=>{
  const root=realpathSync(mkdtempSync(join(tmpdir(),'case-sqlite-search-')));
  const server=createServer(root,{preview:true,scanDocument:async()=>({}),readDocument:read,analyseDocument:analyse});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));rmSync(root,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${server.address().port}`,session=await(await fetch(`${base}/api/session`)).json();
  const headers={'x-case-id':session.caseKey,'x-strategist-token':session.token,'content-type':'application/json'};
  const get=async url=>{const response=await fetch(base+url,{headers});assert.equal(response.status,200,await response.clone().text());return response.json();};
  const prepare=async query=>{const response=await fetch(base+'/api/search/prepare',{method:'POST',headers,body:JSON.stringify({query})});assert.equal(response.status,200,await response.clone().text());return response.json();};
  const {document}=await server.inbox.import(root,'fictional.txt',Buffer.from('Fictional source.'));
  const unscanned=await get('/api/search?q=fictional');assert.match(unscanned.coverage.gaps[0].reason,/no extracted text/);
  await server.inbox.enqueue(root,document.id);await server.inbox.tail;
  const first=(await server.inbox.detail(root,document.id)).reports[0];
  const across=await get('/api/search?q=amber%20cobalt&type=document');assert.equal(across.total,1);assert.equal(across.coverage.fileSearch,'SQLite FTS5');
  const cell=(await get('/api/search?q=cobalt&type=document')).results[0];assert.equal(cell.page,2);assert.equal(cell.anchor.cell,'B4');assert.equal(cell.locator,'Budget · B4');
  const timestamp=(await get('/api/search?q=indigo&type=document')).results[0];assert.equal(timestamp.page,3);assert.equal(timestamp.anchor.startMs,125000);assert.equal(timestamp.locator,'2:05');
  assert.equal((await get('/api/search?q=%22school%20meeting%22&type=document')).total,1);
  assert.equal((await get('/api/search?q=amber%20absent&type=document')).total,0);
  assert.equal((await get('/api/search?q=amber%20absent&type=document&mode=any')).total,1);
  const firstPreview=await get('/api/search/record?key='+encodeURIComponent(`document:${document.id}:r${first.id}:draft`));assert.match(firstPreview.parts[0].text,/First vermilion/);
  const review=await prepare('cobalt');assert.ok(review.sources.some(s=>s.page===2&&s.anchor.cell==='B4'));
  await assert.rejects(()=>server.takeSearchReview({reviewId:review.id,caseKey:session.caseKey,consent:false}),/confirm/);
  assert.equal((await server.takeSearchReview({reviewId:review.id,caseKey:session.caseKey,consent:true})).text,review.text);
  await assert.rejects(()=>server.takeSearchReview({reviewId:review.id,caseKey:session.caseKey,consent:true}),/expired/);
  const stale=await prepare('cobalt');
  server.inbox.analyse=async args=>({...await analyse(args),summary:'Second turquoise report.'});
  await server.inbox.enqueue(root,document.id,{rescan:true});await server.inbox.tail;
  await assert.rejects(()=>server.takeSearchReview({reviewId:stale.id,caseKey:session.caseKey,consent:true}),/changed/);
  assert.equal((await get('/api/search?q=vermilion')).total,0);
  const historical=await get('/api/search?q=vermilion&history=true');assert.equal(historical.total,1);assert.equal(historical.results[0].reportId,first.id);assert.equal(historical.results[0].history,true);
  assert.equal(historical.coverage.counts.draft,1);assert.equal(historical.coverage.historical,1);
  const stillFirst=await get('/api/search/record?key='+encodeURIComponent(historical.results[0].key));assert.match(stillFirst.parts[0].text,/First vermilion/);
});
