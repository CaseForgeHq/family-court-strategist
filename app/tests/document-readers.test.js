import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, realpathSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { readDocument, validateImport, parseTikaXhtml, parseWhisperTranscript } from '../lib/document-readers.js';
import { getReaderStatus, runReaderProcess } from '../lib/reader-dependencies.js';
import { crc32, readZip } from '../lib/reader-zip.js';
import { samplePdf } from './helpers.js';

function fixture(t, name, bytes) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'caseforge-reader-'))), original = `original${name.slice(name.lastIndexOf('.'))}`;
  writeFileSync(join(root, original), bytes);
  const record = { id: createHash('sha256').update(bytes).digest('hex'), name, original, extension: name.slice(name.lastIndexOf('.')) };
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, record };
}

function zip(entries) {
  const locals = [], central = []; let offset = 0;
  for (const [name, text] of entries) {
    const filename = Buffer.from(name), body = Buffer.from(text), local = Buffer.alloc(30), directory = Buffer.alloc(46), crc = crc32(body);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(body.length, 22); local.writeUInt16LE(filename.length, 26);
    directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 6); directory.writeUInt32LE(crc, 16); directory.writeUInt32LE(body.length, 20); directory.writeUInt32LE(body.length, 24); directory.writeUInt16LE(filename.length, 28); directory.writeUInt32LE(offset, 42);
    locals.push(local, filename, body); central.push(directory, filename); offset += local.length + filename.length + body.length;
  }
  const end = Buffer.alloc(22), centralBytes = Buffer.concat(central);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(centralBytes.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBytes, end]);
}

test('real text extraction preserves paragraph and CSV cell locations without external processes', async (t) => {
  const input = fixture(t, 'expenses.csv', Buffer.from('Item,Amount\r\n"School, books",42\r\n"Quoted ""words""",12'));
  const result = await readDocument({ ...input, runProcess: () => assert.fail('Local text must not invoke an external reader') });
  assert.equal(result.pages[2].text, 'School, books'); assert.equal(result.pages[2].anchor.cell, 'A2');
  assert.equal(result.pages[4].text, 'Quoted "words"'); assert.equal(result.coverage.complete, true);
});

test('real PDF extraction includes text and source-linked page rasters', async (t) => {
  const input = fixture(t, 'letter.pdf', samplePdf());
  const result = await readDocument(input);
  assert.match(result.pages[0].text, /Alex reported/); assert.equal(result.images.length, result.pages.length);
  assert.equal(result.images[0].anchor.page, 1); assert.ok(existsSync(join(input.root, result.images[0].path)));
  assert.equal(readFileSync(join(input.root, result.images[0].path)).subarray(1, 4).toString(), 'PNG');
});

test('real image normalization returns a local image and never fabricates text', async (t) => {
  const canvas = createCanvas(40, 30); canvas.getContext('2d').fillRect(0, 0, 40, 30);
  const input = fixture(t, 'stamp.png', canvas.toBuffer('image/png')), result = await readDocument(input);
  assert.equal(result.pages[0].text, ''); assert.equal(result.format, 'image'); assert.equal(result.images.length, 1); assert.equal(result.coverage.complete, true);
});

test('modified originals and misleading PDF extensions fail explicitly', async (t) => {
  assert.throws(() => validateImport('broken.pdf', Buffer.from('text')), /PDF header/);
  assert.equal(validateImport('letter.txt', samplePdf()).format, 'pdf');
  assert.equal(validateImport('scanned-record.dat', samplePdf()).extension, '.pdf');
  const input = fixture(t, 'note.txt', Buffer.from('Original'));
  writeFileSync(join(input.root, input.record.original), 'Changed');
  await assert.rejects(readDocument(input), (error) => error.code === 'source_changed');
});

test('missing reader dependencies preserve the original and report setup required', async (t) => {
  const input = fixture(t, 'letter.docx', Buffer.from('PK fictional fixture'));
  await assert.rejects(readDocument({ ...input, dependencies: {} }), (error) => error.code === 'dependencies_missing' && error.missing.includes('tika'));
  assert.ok(existsSync(join(input.root, input.record.original)));
  assert.equal(getReaderStatus({ directory: join(input.root, 'not-installed') }).state, 'setup_required');
});

test('ZIP member originals remain distinct with parent provenance, without analysing their bodies', async (t) => {
  const input = fixture(t, 'bundle.zip', zip([['letters/letter.txt', 'Private statement'], ['receipt.csv', 'Item,Amount\nBooks,30']]));
  const result = await readDocument(input);
  assert.equal(result.attachments.length, 2); assert.equal(result.attachments[0].parentId, input.record.id);
  assert.equal(result.attachments[0].source.embeddedPath, 'letters/letter.txt');
  assert.equal(readFileSync(join(input.root, result.attachments[0].path), 'utf8'), 'Private statement');
  assert.doesNotMatch(result.pages[0].text, /Private statement/);
  assert.throws(() => readZip(zip([['../escape.txt', 'x']])), /unsafe path/);
  const corrupted = zip([['a.txt', 'abc']]); corrupted[35] ^= 1;
  assert.throws(() => readZip(corrupted), /integrity check/);
});

test('Tika output preserves extracted sheet/table and paragraph context', () => {
  const pages = parseTikaXhtml('<html><body><h1>Expenses</h1><table><tr><td>Books</td><td>45</td></tr></table><p>Alex &amp; Jo</p></body></html>', { spreadsheet: true });
  const amount = pages.find((p) => p.text === '45');
  assert.equal(amount.anchor.sheet, 'Expenses'); assert.equal(amount.anchor.cell, 'B1');
  assert.equal(amount.anchor.locationBasis, 'extracted-table'); assert.equal(pages.at(-1).text, 'Alex & Jo');
});

test('Tika reader never includes child documents in the parent result and flags extraction errors', async (t) => {
  const input = fixture(t, 'letter.doc', Buffer.from('fictional office fixture'));
  const result = await readDocument({ ...input, dependencies: { java: process.execPath, tika: process.execPath }, runProcess: async (_cmd, args) => {
    assert.ok(args.includes('-J'));
    return { stdout: JSON.stringify([{ 'X-TIKA:content': '<body><p>Parent statement</p></body>', 'X-TIKA:EXCEPTION:runtime': 'parse failed' }]), stderr: '' };
  } });
  assert.equal(result.pages[0].text, 'Parent statement'); assert.equal(result.coverage.complete, false);
});

test('timestamped transcripts retain source offsets and reject fabricated timestamps', () => {
  const pages = parseWhisperTranscript({ transcription: [{ text: ' Hello ', offsets: { from: 1200, to: 2400 } }] });
  assert.deepEqual(pages[0].anchor, { kind: 'timestamp', startMs: 1200, endMs: 2400, speaker: null });
  assert.throws(() => parseWhisperTranscript({ transcription: [{ text: 'Hello' }] }), /invalid source timestamps/);
});

test('reader process cancellation is prompt and does not expose subprocess output', async () => {
  const controller = new AbortController(), pending = runReaderProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { signal: controller.signal });
  controller.abort(); await assert.rejects(pending);
  await assert.rejects(runReaderProcess(process.execPath, ['-e', 'console.error("private fixture text");process.exit(2)']), (error) => !error.message.includes('private fixture'));
});
