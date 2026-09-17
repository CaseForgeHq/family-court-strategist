import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyseDocument, ORIENTATION_SCHEMA, verifyLaw } from '../lib/scan-analysis.js';
import { FilesAI } from '../lib/files-ai.js';
import { createServer } from '../server.js';
import { restoreCaseBackup } from '../lib/case-database.js';

function folder() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'caseforge-scan-review-')));
  return root;
}
const report = (complete, attention = []) => ({ complete, summary: 'Fictional fixture.', findings: [], laws: [], attention, coverage: { complete: true }, model: 'gpt-6-astra', effort: 'low' });

test('an unrelated official-source quote cannot authenticate invented legal effective dates', () => {
  const source = { url: 'https://www.legislation.gov.au/fixture', text: 'Fictional Act 2020. Section 3. A person must keep a record. Compilation date: 1 January 2020. This is a fictional source fixture.', sha256: 'fixture', retrievedAt: '2026-09-17T00:00:00.000Z' };
  const law = { url: source.url, title: 'Fictional Act 2020', provision: 'Section 3', text: 'A person must keep a record.', relevance: 'Fictional example', version: 'Fictional Act 2020', effectiveFrom: '1900-01-01', effectiveTo: '2099-12-31', versionEvidence: 'Fictional Act 2020.', assumptions: [] };
  let checked;
  try { checked = verifyLaw(law, [source], ['2024-01-01']); } catch { return; }
  assert.equal(checked.versionStatus, 'needs_date_or_version_review');
});

test('an image omitted from all AI acknowledgements cannot become a completed scan', async (t) => {
  const root = folder(t); writeFileSync(join(root, 'source.png'), 'fictional-image-placeholder');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const checkpoint = {}, scan = async ({ outputSchema }) => ({ text: JSON.stringify(outputSchema === ORIENTATION_SCHEMA ? {
    summary: 'Fictional scan', documentType: 'image', regions: ['QLD'], eventDates: [], needsClarification: false, reason: '', legalIssues: [],
  } : { summary: 'No findings', findings: [], transcriptions: [], limitations: [], contextUpdates: { regions: [], eventDates: [], legalIssues: [], needsClarification: false, reason: '' } }), model: 'gpt-6-astra', effort: 'low' });
  let result;
  try {
    result = await analyseDocument({ root, record: { id: 'a'.repeat(64), name: 'source.png' }, extraction: { pages: [{ page: 1, text: '', anchor: { kind: 'image', image: 1 } }], images: [{ page: 1, path: 'source.png' }], coverage: { complete: true } }, jurisdiction: { country: 'AU', regions: ['QLD'], confirmed: true }, checkpoint, saveCheckpoint: async (_stage, patch = {}) => Object.assign(checkpoint, patch), scan, signal: new AbortController().signal, requestId: 'missing-image-fixture' });
  } catch (error) { assert.match(error.message, /image|coverage|acknowledg|transcri/i); return; }
  assert.equal(result.complete, false, 'Every supplied image needs a positive coverage acknowledgement or an attention result.');
});

test('Retry invalidates completed-but-unsuccessful legal and diagnostic checkpoints', async (t) => {
  const root = folder(t); let calls = 0, secondCheckpoint;
  const store = new FilesAI({ assertWritable: () => {}, scan: async () => ({}), analyse: async ({ checkpoint, saveCheckpoint }) => {
    calls++;
    if (calls === 1) {
      await saveCheckpoint('Legal lookup failed', { legalDone: true, laws: [], legalLimitations: ['Temporary retrieval failure'], diagnostics: { summary: 'Stale conclusion', findings: [] } });
      return report(false, ['Temporary retrieval failure']);
    }
    secondCheckpoint = structuredClone(checkpoint); return report(true);
  } });
  t.after(async () => { await store.close(); rmSync(root, { recursive: true, force: true }); });
  const { document } = await store.import(root, 'fixture.txt', Buffer.from('Fictional court letter in Queensland.'));
  await store.enqueue(root, document.id); await store.tail;
  assert.equal((await store.detail(root, document.id)).scan.state, 'attention');
  await store.control(root, document.id, 'retry'); await store.tail;
  assert.equal(calls, 2); assert.ok(!secondCheckpoint.legalDone, 'A previous failed lookup must not suppress retry.');
  assert.ok(!secondCheckpoint.diagnostics, 'Retry must regenerate conclusions dependent on a failed stage.');
  await store.close();
});

test('jurisdiction correction invalidates conclusions made under the previous jurisdiction', async (t) => {
  const root = folder(t); let calls = 0, staleDiagnostics;
  const store = new FilesAI({ assertWritable: () => {}, scan: async () => ({}), analyse: async ({ checkpoint, saveCheckpoint }) => {
    if (++calls === 1) { await saveCheckpoint('Review needed', { orientation: { regions: ['QLD'] }, diagnostics: { summary: 'QLD-specific conclusion' }, legalDone: true }); return report(false, ['Confirm jurisdiction']); }
    staleDiagnostics = checkpoint.diagnostics; return report(true);
  } });
  t.after(async () => { await store.close(); rmSync(root, { recursive: true, force: true }); });
  const { document } = await store.import(root, 'fixture.txt', Buffer.from('Fictional jurisdiction fixture.'));
  await store.enqueue(root, document.id); await store.tail;
  await store.control(root, document.id, 'resume', { jurisdiction: { country: 'AU', regions: ['NSW'], confirmed: true } }); await store.tail;
  assert.equal(staleDiagnostics, undefined); await store.close();
});

test('source route returns the requested report transcription instead of an empty original extraction', async (t) => {
  const root = folder(t);
  const server = createServer(root, { preview: true, scanDocument: async () => ({}), readDocument: async () => ({ pages: [{ page: 1, text: '', anchor: { kind: 'image', image: 1 } }], images: [], coverage: { complete: true } }), analyseDocument: async () => ({ ...report(true), sourcePages: [{ page: 1, text: 'Fictional exact OCR quotation.', machineTranscribed: true, anchor: { kind: 'image', image: 1 } }] }) });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await server.inbox.close(); await new Promise((resolve) => server.close(resolve)); rmSync(root, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`, session = await (await fetch(`${base}/api/session`)).json();
  const { document } = await server.inbox.import(root, 'source.txt', Buffer.from('Fictional original fixture.'));
  await server.inbox.enqueue(root, document.id); await server.inbox.tail;
  const stored = (await server.inbox.detail(root, document.id)).reports[0];
  const response = await fetch(`${base}/api/documents/${document.id}/source?page=1&reportId=${stored.id}&sourceMatch=machine_transcription`, { headers: { 'x-case-id': session.caseKey } });
  assert.equal(response.status, 200); assert.equal((await response.json()).text, 'Fictional exact OCR quotation.');
  await server.inbox.close(); await new Promise((resolve) => server.close(resolve));
});

test('a case backup is refused while a scan can still write derived files', async (t) => {
  const root = folder(t); let release;
  const store = new FilesAI({ assertWritable: () => {}, scan: async () => ({}), analyse: async () => { await new Promise((resolve) => { release = resolve; }); return report(true); } });
  t.after(async () => { release?.(); await store.close(); rmSync(root, { recursive: true, force: true }); });
  const { document } = await store.import(root, 'fixture.txt', Buffer.from('Fictional backup fixture.'));
  await store.enqueue(root, document.id);
  for (let i = 0; i < 100 && !release; i++) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(release, 'The scan should have reached its active phase.');
  await assert.rejects(store.backup(root), /pause|finish|running|scan/i);
  release(); await store.tail;
  const saved = await store.backup(root);
  assert.ok(saved.manifest.files.some((file) => file.path === document.original));
  await store.close();
});

test('an unsupported attachment is preserved and registered without aborting or scanning the parent', async (t) => {
  const root = folder(t); writeFileSync(join(root, 'child.bin'), 'Fictional unsupported binary'); let scans = 0;
  const store = new FilesAI({ assertWritable: () => {}, scan: async () => ({}), read: async ({ record }) => ({ pages: [{ page: 1, text: 'Fictional parent record.' }], images: [], coverage: { complete: true }, attachments: [{ name: 'attachment.exe', path: 'child.bin', parentId: record.id, source: { kind: 'attachment' } }] }), analyse: async () => { scans++; return report(true); } });
  t.after(async () => { await store.close(); rmSync(root, { recursive: true, force: true }); });
  const { document } = await store.import(root, 'parent.txt', Buffer.from('Fictional parent record.'));
  await store.enqueue(root, document.id); await store.tail;
  assert.equal(scans, 1);
  const child = store.list(root).find((record) => record.id !== document.id);
  assert.ok(child); assert.equal(child.status, 'unsupported'); assert.equal(child.parents[0].parentId, document.id); assert.equal(child.scan, null);
  assert.notEqual((await store.detail(root, document.id)).scan.state, 'failed'); await store.close();
});

test('closing while a case is opening also closes the newly created SQLite worker', { timeout: 5000 }, async (t) => {
  const root = folder(), store = new FilesAI({ assertWritable: () => {} });
  t.after(async () => { for (const state of store.cases.values()) await state.db.close(); rmSync(root, { recursive: true, force: true }); });
  const opening = store.open(root), closing = store.close();
  const [opened] = await Promise.allSettled([opening, closing]);
  assert.equal(store.closed, true); assert.equal(store.opening.size, 0);
  if (opened.status === 'fulfilled') assert.equal(opened.value.db.closed, true);
  for (const state of store.cases.values()) assert.equal(state.db.closed, true);
});

test('identical originals scanned concurrently in different cases retain separate results', async (t) => {
  const first = folder(), second = folder(), releases = new Map();
  const store = new FilesAI({ assertWritable: () => {}, scan: async () => ({}), analyse: async ({ root }) => {
    await new Promise((resolve) => releases.set(root, resolve));
    return { ...report(true), summary: root === first ? 'First case only.' : 'Second case only.' };
  } });
  t.after(async () => { for (const release of releases.values()) release(); await store.close(); rmSync(first, { recursive: true, force: true }); rmSync(second, { recursive: true, force: true }); });
  const bytes = Buffer.from('Identical fictional original in two different cases.');
  const one = await store.import(first, 'same.txt', bytes), two = await store.import(second, 'same.txt', bytes);
  assert.equal(one.document.id, two.document.id);
  await store.enqueue(first, one.document.id); await store.enqueue(second, two.document.id);
  for (let i = 0; i < 100 && releases.size < 2; i++) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(releases.size, 2); releases.get(second)(); releases.get(first)(); await store.tail;
  assert.equal((await store.detail(first, one.document.id)).reports[0].summary, 'First case only.');
  assert.equal((await store.detail(second, two.document.id)).reports[0].summary, 'Second case only.');
  await store.close();
});

test('earlier report source text and image versions survive rescanning and relocated backup restore', async (t) => {
  const root = folder(), restoredRoot = folder(); let generation = 0;
  const server = createServer(root, { preview: true, scanDocument: async () => ({}), readDocument: async () => {
    generation++; const path = `image-${generation}.png`; writeFileSync(join(root, path), `Fictional image bytes ${generation}`);
    return { pages: [{ page: 1, text: `Fictional source version ${generation}.`, anchor: { kind: 'paragraph', paragraph: 1 } }], images: [{ page: 1, path }], coverage: { complete: true } };
  }, analyseDocument: async ({ extraction }) => ({ ...report(true), sourcePages: extraction.pages, sourceImages: extraction.images }) });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const restored = new FilesAI({ assertWritable: () => {} });
  t.after(async () => { await server.inbox.close(); await restored.close(); await new Promise((resolve) => server.close(resolve)); rmSync(root, { recursive: true, force: true }); rmSync(restoredRoot, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`, session = await (await fetch(`${base}/api/session`)).json();
  const { document } = await server.inbox.import(root, 'source.txt', Buffer.from('Fictional immutable original.'));
  await server.inbox.enqueue(root, document.id); await server.inbox.tail;
  const oldReport = (await server.inbox.detail(root, document.id)).reports[0];
  await server.inbox.enqueue(root, document.id, { rescan: true }); await server.inbox.tail;
  const source = await fetch(`${base}/api/documents/${document.id}/source?page=1&reportId=${oldReport.id}&sourceMatch=text_match`, { headers: { 'x-case-id': session.caseKey } });
  assert.equal((await source.json()).text, 'Fictional source version 1.');
  const image = await fetch(`${base}/api/documents/${document.id}/image?page=1&reportId=${oldReport.id}`, { headers: { 'x-case-id': session.caseKey } });
  assert.equal(await image.text(), 'Fictional image bytes 1');
  const backup = await server.inbox.backup(root); restoreCaseBackup(join(root, backup.path), restoredRoot);
  await restored.open(restoredRoot);
  const oldCopy = (await restored.detail(restoredRoot, document.id)).reports.find((item) => item.id === oldReport.id);
  assert.equal(oldCopy.sourcePages[0].text, 'Fictional source version 1.');
  assert.equal(readFileSync(join(restoredRoot, oldCopy.sourceImages[0].path), 'utf8'), 'Fictional image bytes 1');
  assert.equal(restored.record(restoredRoot, document.id).reference, document.reference);
  await server.inbox.close(); await restored.close();
});

test('a corrupted backup fails validation before writing any destination files', async (t) => {
  const root = folder(), target = folder(), store = new FilesAI({ assertWritable: () => {} });
  t.after(async () => { await store.close(); rmSync(root, { recursive: true, force: true }); rmSync(target, { recursive: true, force: true }); });
  const { document } = await store.import(root, 'fixture.txt', Buffer.from('Fictional backup integrity fixture.'));
  const backup = await store.backup(root);
  writeFileSync(join(root, backup.path, 'case', document.original), 'Changed backup bytes');
  assert.throws(() => restoreCaseBackup(join(root, backup.path), target), /checksum mismatch/);
  assert.deepEqual(readdirSync(target), []); await store.close();
});
