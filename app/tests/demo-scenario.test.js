import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateDemo, DEMO_PRESETS } from '../lib/demo-data.js';
import { buildCaseModel } from '../lib/vault.js';
import { Notebook } from '../lib/notebook.js';
import { parseFrontmatter } from '../lib/frontmatter.js';
import { Inbox } from '../lib/inbox.js';

for (const preset of DEMO_PRESETS) test(`${preset.label} creates a linked fictional case with readable sources and private notes`, async () => {
  const root = mkdtempSync(join(tmpdir(), 'caseforge-scenario-'));
  await generateDemo({ root, size: preset.id, now: new Date('2026-09-17T00:00:00Z') });
  const model = buildCaseModel(root), manifest = JSON.parse(readFileSync(join(root, '.case-forge/demo.json')));
  assert.equal(model.people.length, preset.people);
  assert.equal(model.timeline.length, preset.events);
  assert.deepEqual(model.graph.unresolvedLinks, []);
  assert.ok(model.graph.edges.some(edge => edge.source.startsWith('people/') && edge.target.startsWith('people/')));
  const pages = new Notebook(root).list();
  assert.equal(pages.length, preset.notes);
  assert.ok(pages.some(page => page.title.includes('Start here')));
  assert.ok(!model.timeline.some(event => /Missing receipt|Try editing|Start here/.test(event.title)));
  const inbox = new Inbox({ providers: {}, assertWritable() {} });
  const documents = inbox.list(root);
  assert.equal(documents.length, preset.files);
  assert.ok(documents.every(doc => doc.status === 'ready'));
  const sources = documents.map(doc => readFileSync(join(root, doc.original), 'utf8'));
  assert.ok(sources.some(source => /In-Reply-To:/.test(source)));
  assert.ok(sources.every(source => source.includes('Fictional sample data')));
  assert.ok(sources.some(source => source.includes('3:30 pm')));
  assert.ok(sources.some(source => source.includes('4:00 pm')));
  assert.ok(model.timeline.some(event => event.title.includes('Case opened')));
  assert.ok(model.timeline.some(event => event.title.includes('Case closed')));
  assert.ok(model.timeline.some(event => event.title.includes('Agreed collection')));
  for (const event of model.timeline) {
    const { data } = parseFrontmatter(readFileSync(join(root, event.reference), 'utf8'));
    const source = readFileSync(join(root, data.source_file), 'utf8');
    assert.ok(source.includes(event.date), 'event date agrees with its source');
    assert.ok(!source.includes('Record type: expense'), 'private expense record is not an external-contact event');
  }
  assert.equal(manifest.caseStart, '2026-06-19');
  assert.equal(manifest.caseEnd, '2026-09-16');
  assert.ok(manifest.emailExports >= 5);
});

test('simulation refuses an existing case and preserves its contents', async () => {
  const root = mkdtempSync(join(tmpdir(), 'caseforge-preserve-'));
  writeFileSync(join(root, 'existing.txt'), 'Keep this case unchanged');
  await assert.rejects(generateDemo({ root, size: 'small' }), /empty demo folder/);
  assert.equal(readFileSync(join(root, 'existing.txt'), 'utf8'), 'Keep this case unchanged');
});
