import { SCAN_QUESTIONS } from '../public/scan-questions.js';
import { validateAnswers, ANSWERS_SCHEMA, reportMarkdown } from '../lib/scan-analysis.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
const valid = () => ({answers:SCAN_QUESTIONS.map(q=>({questionId:q.id,status:'no_findings',answer:'No finding identified in the supplied content.',findingIds:[],lawIndexes:[],limitations:'Only this document was reviewed.',followUp:'None identified.'}))});
test('question contract has 13 distinct IDs and rejects missing, duplicate and unknown answers',()=>{
  assert.equal(new Set(SCAN_QUESTIONS.map(q=>q.id)).size,13);
  assert.equal(ANSWERS_SCHEMA.properties.answers.items.required.length,7);
  const missing=valid();missing.answers.pop();assert.throws(()=>validateAnswers(missing,[],[]),/all 13/);
  const duplicate=valid();duplicate.answers[12]=duplicate.answers[0];assert.throws(()=>validateAnswers(duplicate,[],[]),/missing or duplicated/);
  const unknown=valid();unknown.answers[0].questionId='other';assert.throws(()=>validateAnswers(unknown,[],[]),/missing or duplicated/);
});
test('answers resolve only to this report evidence and retain canonical order',()=>{
  const value=valid();value.answers.reverse();value.answers.find(a=>a.questionId==='facts').findingIds=['local-fact'];
  const answers=validateAnswers(value,[{id:'local-fact'}],[]);
  assert.deepEqual(answers.map(a=>a.id),SCAN_QUESTIONS.map(q=>q.id));
  assert.throws(()=>validateAnswers(value,[{id:'other-case'}],[]),/outside this report/);
  value.answers[0].lawIndexes=[3];assert.throws(()=>validateAnswers(value,[{id:'local-fact'}],[]),/outside this report/);
});
test('saved markdown contains the actual questions, statuses and consistent answer fields',()=>{
  const questionAnswers=validateAnswers(valid(),[],[]);
  const markdown=reportMarkdown({questionAnswers,findings:[],laws:[],coverage:{}},{id:'fictional',name:'fictional.txt'});
  assert.match(markdown,/Scan questions and answers/);assert.match(markdown,/What is this document about/);
  assert.match(markdown,/Evidence IDs:/);assert.match(markdown,/Follow-up:/);
});
