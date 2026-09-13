import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker from './worker.mjs';
const origin='https://case-forge.example';
function setup(t){
 const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('./migrations/0001_waitlist.sql',import.meta.url),'utf8'));t.after(()=>db.close());
 const env={PUBLIC_ORIGIN:origin,WAITLIST_RATE_LIMIT:{limit:async()=>({success:true})},DB:{prepare:sql=>({bind:(...values)=>({run:async()=>db.prepare(sql).run(...values)})})},ASSETS:{fetch:async()=>new Response('asset')}};
 const send=(body,headers={})=>worker.fetch(new Request(origin+'/api/waitlist',{method:'POST',headers:{origin,'content-type':'application/json',...headers},body:JSON.stringify(body)}),env);
 return {db,env,send};
}
const person={name:'Deployment test',email:'test@example.test',platform:'mac',consent:true};
test('homepage serves its asset and the duplicate index URL redirects to its canonical address',async t=>{
 const s=setup(t);let requested;
 s.env.ASSETS.fetch=async request=>{requested=request;return new Response('home')};
 assert.equal(await(await worker.fetch(new Request(origin+'/'),s.env)).text(),'home');assert.equal(requested.url,origin+'/index.html');
 const redirect=await worker.fetch(new Request(origin+'/index.html?source=readme'),s.env);assert.equal(redirect.status,308);assert.equal(redirect.headers.get('location'),origin+'/?source=readme');
});
test('Cloudflare signup persists, deduplicates and keeps responses private',async t=>{
 const s=setup(t),one=await s.send(person),two=await s.send({...person,email:'TEST@example.test'});
 assert.equal(one.status,200);assert.deepEqual(await one.json(),await two.json());assert.equal(s.db.prepare('SELECT COUNT(*) n FROM waitlist').get().n,1);assert.equal(s.db.prepare('SELECT consent_version FROM waitlist').get().consent_version,'desktop-launch-v1');assert.equal(one.headers.get('cache-control'),'no-store');
});
test('Cloudflare rejects cross-origin, invalid, oversized and rate-limited submissions',async t=>{
 const s=setup(t);assert.equal((await s.send(person,{origin:'https://other.example'})).status,403);assert.equal((await s.send({...person,consent:false})).status,400);assert.equal((await s.send({...person,name:'x'.repeat(5000)})).status,413);assert.equal((await s.send({...person,company:'spam'})).status,400);
 s.env.WAITLIST_RATE_LIMIT.limit=async()=>({success:false});assert.equal((await s.send(person)).status,429);assert.equal(s.db.prepare('SELECT COUNT(*) n FROM waitlist').get().n,0);
});
test('database failure is not presented as signup success; no public database/admin endpoint exists',async t=>{
 const s=setup(t);s.env.DB.prepare=()=>{throw new Error('private database detail')};const failed=await s.send(person);assert.equal(failed.status,503);assert.doesNotMatch(await failed.text(),/private database/);
 assert.equal((await worker.fetch(new Request(origin+'/api/waitlist'),s.env)).status,405);assert.equal((await worker.fetch(new Request(origin+'/api/admin'),s.env)).status,404);
 const config=await worker.fetch(new Request(origin+'/site-config.js'),s.env);assert.match(await config.text(),/waitlistEndpoint:"\/api\/waitlist"/);assert.equal(config.headers.get('cache-control'),'no-store');
});
