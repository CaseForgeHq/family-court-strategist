import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {generateDemo} from '../lib/demo-data.js';
import {Inbox} from '../lib/inbox.js';
import {REVIEW_FIXTURES} from '../lib/review-fixtures.js';
test('review demo imports all mixed case sources through the real reader without an answer key',async()=>{
 const root=await mkdtemp(join(tmpdir(),'caseforge-mixed-fixtures-'));
 try {
  await generateDemo({root,size:'review'});
  const inbox=new Inbox({providers:{},assertWritable:()=>{}});
  const result=inbox.list(root);
  const docs=Array.isArray(result)?result:result.documents;
  assert.equal(docs.length,10);
  assert.deepEqual(docs.map(d=>d.name).sort(),REVIEW_FIXTURES.map(d=>d.name).sort());
  for(const d of docs) {const record=inbox.detail(root,d.id);assert.equal(record.status,'ready');assert.ok(record.pages.some(p=>p.text.includes('FICTIONAL TEST RECORD')));assert.equal(record.scan,undefined);}
  assert.ok(!(await readdir(root)).some(n=>n.includes('answer-key')));
  const key=JSON.parse(await readFile(new URL('../../test-fixtures/mixed-family-case/answer-key.json',import.meta.url)));
  assert.deepEqual(key.documents.map(d=>d.file).sort(),docs.map(d=>d.name).sort());
 } finally {await rm(root,{recursive:true,force:true});}
});
