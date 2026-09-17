import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { buildSearchIndex, searchIndex, createSearchReviews } from '../lib/case-index.js';
import { buildCaseModel } from '../lib/vault.js';
import { Notebook } from '../lib/notebook.js';
import { Tasks, taskTargets } from '../lib/tasks.js';
import { createServer } from '../server.js';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'caseforge-index-'));
  t.after(() => rmSync(root, {recursive:true,force:true}));
  const id = 'a'.repeat(64), documents = [{id, name:'Letter.pdf', original:'letter.pdf', reference:'CF-ABCDEF123456-000001', status:'ready', createdAt:'2026-09-17T00:00:00Z'}];
  const storage = join(root,'.strategist','documents',id); mkdirSync(storage,{recursive:true});
  writeFileSync(join(storage,'pages.json'),JSON.stringify([{page:1,text:'A generic opening.'},{page:2,text:'Scarlet hibiscus was discussed at the school meeting.'}]));
  writeFileSync(join(storage,'document.json'),JSON.stringify(documents[0]));
  writeFileSync(join(root,'meeting.md'),'---\ntype: event\nevent_id: EVT-1\ndate: 2026-09-17\nsource_file: letter.pdf\nsource_page: 2\n---\n# School meeting\nBlue orchid details. [[person]]');
  writeFileSync(join(root,'person.md'),'---\ntype: person\nrole: teacher\n---\n# Alex Rivera\nA contact at the school.');
  mkdirSync(join(root,'.private')); writeFileSync(join(root,'.private','secret.md'),'hidden credential sentinel');
  mkdirSync(join(root,'_templates')); writeFileSync(join(root,'_templates','blank.md'),'template sentinel');
  const nb = new Notebook(root); const page = randomUUID();
  nb.save({id:page,title:'Personal notebook',body:'Old lavender wording',expectedRevision:0});
  nb.save({id:page,title:'Personal notebook',body:'Current silver violet wording',expectedRevision:1});
  const journal = { read:()=>({entries:{j:{id:'j',recordedAt:'2026-09-17',revisions:[{revision:1,content:{title:'My account',happened:'Silver violet exchange',reflection:'Private reflection sentinel',links:[]}}]}}}) };
  const tasks = { read:()=>({entries:{t:{id:'t',revisions:[{revision:1,content:{title:'Prepare',details:'Marigold detail',source:{id:'note:meeting.md'},completionNote:'Finished sunflower',status:'done'}}]}}}) };
  const calendar = { read:()=>({entries:{c:{id:'c',revisions:[{revision:1,content:{title:'Call',details:'Daffodil details',date:'2026-10-01',status:'active'}}]}}}) };
  const facts = { read:()=>({facts:{f:{id:'FACT-00001',conflicts:[],revisions:[{revision:1,statement:'Tulip verified source',status:'PROPOSED',sources:[{path:'letter.pdf',quote:'Daisy quotation'}]}]}}}) };
  const build = () => buildSearchIndex({root,model:buildCaseModel(root),documents,notebook:nb,journal,tasks,calendar,facts});
  return {root,id,documents,storage,build,nb,page};
}
test('index searches body text, source pages, metadata and every saved store with separate historical versions',t=>{
  const f=fixture(t), index=f.build();
  for(const [q,category] of [['scarlet hibiscus','document'],['orchid','event'],['Rivera','person'],['marigold','task'],['sunflower','task'],['daffodil','calendar'],['Daisy','fact'],['reflection sentinel','journal'],['current silver','notebook']]) assert.equal(searchIndex(index,q).results[0].category,category,q);
  const doc=searchIndex(index,'scarlet hibiscus').results[0]; assert.equal(doc.page,2); assert.match(doc.text,/Scarlet hibiscus/);
  assert.equal(searchIndex(index,'000001').results[0].id,f.id);
  assert.equal(searchIndex(index,'lavender').total,0); const older=searchIndex(index,'lavender',{history:true}).results[0]; assert.equal(older.history,true); assert.equal(older.revision,1);
  for(const q of ['hidden credential','template sentinel']) assert.equal(searchIndex(index,q,{history:true}).total,0);
  assert.equal(index.coverage.historical,1); assert.ok(index.coverage.links>=3);
  assert.equal(searchIndex(index,'"school meeting"').total,2);
  assert.equal(searchIndex(index,'orchid nonexistent').total,0); assert.ok(searchIndex(index,'orchid nonexistent',{mode:'any'}).total>0);
});
test('pagination returns every match beyond the former 40-result limit, filters are counted before paging',t=>{
  const f=fixture(t);
  for(let n=0;n<127;n++) writeFileSync(join(f.root,`record-${n}.md`),`# Registry ${n}\nUnique searchable record token`);
  const index=f.build(), keys=[];
  for(let offset=0;offset<127;offset+=50) { const result=searchIndex(index,'searchable record',{offset}); assert.equal(result.total,127); keys.push(...result.results.map(r=>r.key)); }
  assert.equal(new Set(keys).size,127); assert.equal(searchIndex(index,'school',{type:'person'}).total,1);
  assert.throws(()=>searchIndex(index,'x'.repeat(301)),/300/);
});
test('missing text and corrupt stores are surfaced without dropping other results',t=>{
  const f=fixture(t); writeFileSync(join(f.storage,'pages.json'),'not JSON');
  const index=f.build(); assert.equal(searchIndex(index,'Letter',{type:'document'}).total,1); assert.match(index.coverage.gaps[0].reason,/unavailable/);
  assert.equal(searchIndex(index,'orchid').total,1);
  writeFileSync(join(f.storage,'pages.json'),JSON.stringify([{page:1,text:''}])); assert.match(f.build().coverage.gaps[0].reason,/recognition/);
});
test('deep search expands recorded links, excludes personal text by default and requires fresh single-use consent',t=>{
  const f=fixture(t), reviews=createSearchReviews(f.build);
  const review=reviews.prepare({query:'What happened with scarlet hibiscus?'});
  assert.ok(review.sources.some(s=>s.id==='meeting.md')); assert.ok(review.sources.some(s=>s.id===f.id));
  assert.ok(review.text.length<39000); assert.match(review.text,/untrusted evidence/);
  assert.throws(()=>reviews.take(review.id,false),/confirm/);
  assert.equal(reviews.take(review.id,true).text,review.text); assert.throws(()=>reviews.take(review.id,true),/expired/);
  assert.throws(()=>reviews.prepare({query:'silver violet'}),/No readable/);
  const personal=reviews.prepare({query:'silver violet',includePersonal:true}); assert.match(personal.text,/Private reflection/);
  assert.ok(personal.sources.every(s=>!s.history));
  writeFileSync(join(f.root,'person.md'),'# New person\nChanged locally'); assert.throws(()=>reviews.take(personal.id,true),/changed/);
  let now=0; const expiring=createSearchReviews(f.build,{now:()=>now}), ready=expiring.prepare({query:'scarlet'}); now=600001; assert.throws(()=>expiring.take(ready.id,true),/expired/);
});
test('HTTP search respects case, token and local-source boundaries; fresh saved notebook changes are searchable',async t=>{
  const f=fixture(t), before=readdirSync(f.root), server=createServer(f.root,{preview:true});
  await new Promise(r=>server.listen(0,'127.0.0.1',r)); t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
  const base=`http://127.0.0.1:${server.address().port}`, session=await(await fetch(base+'/api/session')).json();
  const headers={'x-case-id':session.caseKey,'x-strategist-token':session.token,'content-type':'application/json'};
  assert.equal((await fetch(base+'/api/search?q=orchid')).status,409);
  const found=await(await fetch(base+'/api/search?q=scarlet',{headers})).json(); assert.equal(found.results[0].page,2);
  assert.equal((await fetch(base+'/api/search/record?key=note:../private.md',{headers})).status,404);
  const record=await(await fetch(base+'/api/search/record?key='+encodeURIComponent(found.results[0].key),{headers})).json(); assert.match(record.parts[2].text,/Scarlet/);
  const body=JSON.stringify({query:'orchid'});
  assert.equal((await fetch(base+'/api/search/prepare',{method:'POST',headers:{...headers,'x-strategist-token':'bad'},body})).status,403);
  const review=await(await fetch(base+'/api/search/prepare',{method:'POST',headers,body})).json();
  assert.throws(()=>server.takeSearchReview({reviewId:review.id,caseKey:'other',consent:true}),/case changed/);
  assert.equal(server.takeSearchReview({reviewId:review.id,caseKey:session.caseKey,consent:true}).text,review.text);
  f.nb.save({id:f.page,title:'Personal notebook',body:'New periwinkle body',expectedRevision:2});
  assert.equal((await(await fetch(base+'/api/search?q=periwinkle',{headers})).json()).total,1);
  assert.deepEqual(readdirSync(f.root),before,'Search creates no new index files');
});

test('a changed task source puts the same review-required deadline state into search and Calendar',async t=>{
  const f=fixture(t), tasks=new Tasks(f.root), id=randomUUID();
  tasks.save({id,requestId:randomUUID(),expectedRevision:0,actor:'Fictional reviewer',reason:'',confirmDeadline:true,
    content:{title:'Bring the letter',kind:'task',assignee:'Alex',details:'Prepare school records',status:'todo',completionNote:'',sourceId:'note:meeting.md',sourceDigest:taskTargets(f.root).find(t=>t.id==='note:meeting.md').digest,sourceLocator:'Recorded event',dueDate:'2026-10-01',deadlineStatus:'confirmed',dateOrigin:'source',deadlineBasis:'Checked the fictional date',timeZone:'Australia/Brisbane',reminderDate:''}});
  const server=createServer(f.root,{preview:true}); await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
  const base=`http://127.0.0.1:${server.address().port}`, session=await(await fetch(base+'/api/session')).json(),headers={'x-case-id':session.caseKey};
  const initial=await(await fetch(base+'/api/search?q=Bring',{headers})).json();assert.match(initial.results[0].status,/deadline confirmed/);
  writeFileSync(join(f.root,'meeting.md'),'---\ntype: event\nevent_id: EVT-1\ndate: 2026-09-18\n---\n# Changed meeting\nThe source date was corrected.');
  const changed=await(await fetch(base+'/api/search?q=review_required',{headers})).json();assert.equal(changed.results[0].id,id);assert.match(changed.results[0].status,/source changed/);
  const calendar=await(await fetch(base+'/api/calendar',{headers})).json();assert.equal(calendar.events.find(e=>e.id===`task:${id}`).dateState,'review_required');
});
