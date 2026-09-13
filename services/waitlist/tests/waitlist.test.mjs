import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createWebsite} from '../server.mjs';
async function setup(t,options={}){const dir=mkdtempSync(join(tmpdir(),'case-forge-waitlist-')),database=join(dir,'list.sqlite');const server=createWebsite({database,...options});await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;t.after(async()=>{await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});});const post=(body,headers={})=>fetch(origin+'/api/waitlist',{method:'POST',headers:{origin,'content-type':'application/json',...headers},body:JSON.stringify(body)});return{database,server,origin,post};}
const person={name:'Preview Person',email:'preview@example.test',platform:'mac',consent:true};
test('signup persists with explicit consent; repeat requests do not duplicate or reveal membership',async t=>{const s=await setup(t);const one=await s.post(person),two=await s.post({...person,email:'PREVIEW@example.test'});assert.equal(one.status,200);assert.deepEqual(await one.json(),await two.json());const db=new DatabaseSync(s.database,{readOnly:true});const rows=db.prepare('SELECT * FROM waitlist').all();assert.equal(rows.length,1);assert.equal(rows[0].consent_version,'desktop-launch-v1');db.close();});
test('validation and cross-origin requests cannot add a signup',async t=>{const s=await setup(t);assert.equal((await s.post({...person,consent:false})).status,400);assert.equal((await s.post({...person,email:'bad'})).status,400);assert.equal((await s.post(person,{origin:'https://unrelated.example'})).status,403);const db=new DatabaseSync(s.database,{readOnly:true});assert.equal(db.prepare('select count(*) n from waitlist').get().n,0);db.close();});
test('private database is not served; local config enables form; rate limiting works',async t=>{const s=await setup(t,{rateLimit:1});assert.equal((await fetch(s.origin+'/.local/waitlist.sqlite')).status,404);assert.match(await(await fetch(s.origin+'/site-config.js')).text(),/api\/waitlist/);assert.equal((await s.post(person)).status,200);assert.equal((await s.post(person)).status,429);});
test('only configured public website origins receive CORS permission',async t=>{const s=await setup(t,{publicOrigin:'https://api.example.test',allowedOrigins:['https://site.example.test']});const good=await s.post(person,{origin:'https://site.example.test'});assert.equal(good.status,200);assert.equal(good.headers.get('access-control-allow-origin'),'https://site.example.test');assert.equal((await s.post(person,{origin:'https://other.example.test'})).status,403);});
test('static delivery compresses text, revalidates content and keeps local pages out of search',async t=>{
 const s=await setup(t);const response=await fetch(s.origin+'/',{headers:{'accept-encoding':'gzip'}});assert.equal(response.headers.get('content-encoding'),'gzip');assert.match(await response.text(),/Case Forge/);assert.match(response.headers.get('x-robots-tag'),/noindex/);
 const etag=response.headers.get('etag');assert.ok(etag);assert.equal((await fetch(s.origin+'/',{headers:{'accept-encoding':'gzip','if-none-match':etag}})).status,304);
 const plain=await fetch(s.origin+'/',{headers:{'accept-encoding':'gzip;q=0'}});assert.equal(plain.headers.get('content-encoding'),null);assert.notEqual(plain.headers.get('etag'),etag);
 const head=await fetch(s.origin+'/',{method:'HEAD'});assert.equal(await head.text(),'');assert.ok(Number(head.headers.get('content-length'))>0);
 const redirect=await fetch(s.origin+'/index.html?from=guide',{redirect:'manual'});assert.equal(redirect.status,308);assert.equal(redirect.headers.get('location'),'/?from=guide');
 const sitemap=await fetch(s.origin+'/sitemap.xml');assert.equal(sitemap.status,200);assert.match(sitemap.headers.get('content-type'),/application\/xml/);
 const asset=await fetch(s.origin+'/media/desktop-overview.webp');assert.equal(asset.status,200);assert.match(asset.headers.get('cache-control'),/max-age=86400/);
});
