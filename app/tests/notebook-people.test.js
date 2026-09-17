import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Notebook } from '../lib/notebook.js';
import { addPerson } from '../lib/people.js';
import { buildCaseModel } from '../lib/vault.js';
import { createServer } from '../server.js';
const fixture = () => mkdtempSync(join(tmpdir(), 'caseforge-notebook-'));
const page = () => ({ id: randomUUID(), title: 'Questions', body: 'Check the dates.', expectedRevision: 0 });
test('notebook persists revisions, rejects stale overwrites and remains outside the factual case model', () => {
  const root = fixture(), notebook = new Notebook(root), input = page();
  assert.deepEqual(notebook.list(), []); assert.equal(existsSync(join(root, '.case-forge')), false);
  const first = notebook.save(input); assert.equal(first.revision, 1);
  const second = notebook.save({ ...input, body: 'New question', expectedRevision: 1 }); assert.equal(second.revision, 2);
  assert.throws(() => notebook.save(input), /newer saved version/);
  assert.equal(new Notebook(root).list()[0].body, 'New question');
  assert.equal(buildCaseModel(root).graph.nodes.length, 0);
  const state = JSON.parse(readFileSync(join(root, '.case-forge/notebook/pages.json'))); assert.equal(state.pages[input.id].revisions[0].body, input.body);
});
test('notebook validates size and identity and refuses read-only writes', () => {
  const root = fixture(), notebook = new Notebook(root);
  for (const value of [{ ...page(), id: '../outside' }, { ...page(), body: 'x'.repeat(8001) }, { ...page(), title: '', body: '' }]) assert.throws(() => notebook.save(value));
  const readOnly = new Notebook(root, { assertWritable() { throw new Error('Read only'); } }); assert.throws(() => readOnly.save(page()), /Read only/);
  assert.equal(existsSync(join(root, '.case-forge')), false);
});
test('adding a person creates a portable note and an explicit existing-event connection', () => {
  const root = fixture(); mkdirSync(join(root, 'timeline')); const existing = '---\ntype: event\nevent_id: E1\ndate: 2026-09-17\n---\n# Meeting\n'; writeFileSync(join(root, 'timeline/meeting.md'), existing);
  const value = { name: 'Sam Example', role: 'Support person', notes: 'Fictional fixture.', related: 'timeline/meeting.md' };
  const person = addPerson(root, value, { assertWritable() {}, model: buildCaseModel(root) });
  const model = buildCaseModel(root); assert.equal(model.people[0].name, value.name); assert.equal(model.people[0].role, value.role);
  assert.ok(model.graph.edges.some(e => e.source === person.reference && e.target === value.related)); assert.deepEqual(model.graph.unresolvedLinks, []);
  assert.equal(readFileSync(join(root, 'timeline/meeting.md'), 'utf8'), existing);
  assert.throws(() => addPerson(root, { ...value, related: '../outside.md' }, { assertWritable() {}, model }), /event from this case/);
  assert.throws(() => addPerson(root, { ...value, name: 'Bad\ntype:system' }, { assertWritable() {}, model }), /name/);
});
test('notebook and person API writes require the current case token and expose actual saved records', async t => {
  const root = fixture(), server = createServer(root, { preview: true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => { server.closeWorkspace(); server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}`, session = await fetch(url + '/api/session').then(r => r.json());
  const headers = { 'x-case-id': session.caseKey, 'x-strategist-token': session.token, 'content-type': 'application/json' };
  const request = (path, body, h = headers) => fetch(url + path, { method: 'POST', headers: h, body: JSON.stringify(body) });
  assert.equal((await request('/api/notebook', page(), { ...headers, 'x-strategist-token': '' })).status, 403);
  assert.equal((await request('/api/people', { name: 'Alex', role: '', notes: '' }, { ...headers, 'x-case-id': 'old' })).status, 409);
  assert.equal((await request('/api/notebook', page())).status, 200);
  assert.equal((await request('/api/people', { name: 'Alex Example', role: 'Parent', notes: '', related: '' })).status, 200);
  const notebook = await fetch(url + '/api/notebook', { headers }).then(r => r.json()); assert.equal(notebook.pages.length, 1);
  const model = await fetch(url + '/api/case', { headers }).then(r => r.json()); assert.equal(model.people[0].name, 'Alex Example');
});


test('person details and connections persist without creating timeline events and reject stale edits', () => {
  const root = fixture(); const options = () => ({ assertWritable() {}, model: buildCaseModel(root) });
  const a = addPerson(root, { name: 'Alex', role: '', notes: '' }, options());
  const b = addPerson(root, { name: 'Sam', role: 'Solicitor', notes: '' }, options());
  const input = { reference: a.reference, expectedRevision: a.revision, name: 'Alex Updated', role: 'Parent', notes: 'Details', connections: [b.reference] };
  const saved = addPerson(root, input, options());
  const model = buildCaseModel(root);
  assert.equal(model.people.find(p => p.reference === a.reference).name, 'Alex Updated');
  assert.ok(model.graph.edges.some(e => e.source === a.reference && e.target === b.reference));
  assert.equal(model.timeline.length, 0); assert.equal(model.people.length, 2);
  assert.throws(() => addPerson(root, input, options()), /has changed/);
  addPerson(root, { ...input, expectedRevision: saved.revision, connections: [] }, options());
  assert.equal(buildCaseModel(root).graph.edges.length, 0);
  assert.throws(() => addPerson(root, { name: 'Bad link', role: '', notes: '', connections: ['../outside.md'] }, options()), /people from this case/);
});
