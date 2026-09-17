import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, realpathSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readDocument } from '../lib/document-readers.js';
import { getReaderStatus, runReaderProcess } from '../lib/reader-dependencies.js';

const configured = process.env.CASE_FORGE_READERS_TEST_DIR;
const status = configured ? getReaderStatus({ directory: configured }) : null;
const skip = !status?.ready ? 'Set CASE_FORGE_READERS_TEST_DIR to a provisioned readers directory for native fixture verification.' : false;

function fixture(t, name, bytes) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'caseforge-native-reader-')));
  writeFileSync(join(root, name), bytes);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, record: { name, original: name, id: createHash('sha256').update(bytes).digest('hex') }, dependencies: status.paths };
}

test('native Tika reads RTF and preserves the fictional source text', { skip }, async (t) => {
  const input = fixture(t, 'letter.rtf', Buffer.from('{\\rtf1\\ansi Alex reported that the school meeting occurred on 19 March 2024.\\par This is a fictional test record.}'));
  const result = await readDocument(input);
  assert.match(result.pages.map((p) => p.text).join('\n'), /school meeting occurred on 19 March 2024/);
  assert.equal(result.coverage.complete, true);
});

test('native Tika registers MIME attachments without mixing child text into the parent report', { skip }, async (t) => {
  const body = ['From: Alex <alex@example.invalid>', 'To: Jo <jo@example.invalid>', 'Date: Tue, 19 Mar 2024 10:00:00 +1000', 'Subject: Fictional meeting', 'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="fixture-boundary"', '', '--fixture-boundary', 'Content-Type: text/plain; charset=utf-8', '', 'The meeting starts at ten.', '--fixture-boundary', 'Content-Type: text/plain; name="note.txt"', 'Content-Disposition: attachment; filename="note.txt"', 'Content-Transfer-Encoding: base64', '', Buffer.from('Separate attachment statement.').toString('base64'), '--fixture-boundary--', ''].join('\r\n');
  const input = fixture(t, 'email.eml', Buffer.from(body)), result = await readDocument(input);
  assert.match(result.pages.map((p) => p.text).join('\n'), /meeting starts at ten/);
  assert.equal(result.attachments.length, 1);
  assert.match(readFileSync(join(input.root, result.attachments[0].path), 'utf8'), /Separate attachment statement/);
  assert.doesNotMatch(result.pages.map((p) => p.text).join('\n'), /Separate attachment statement/);
});

test('native FFmpeg samples silent video with true source timestamps and duplicate suppression', { skip, timeout: 120_000 }, async (t) => {
  const input = fixture(t, 'placeholder.txt', Buffer.from('fictional fixture'));
  const movie = join(input.root, 'video.mp4');
  await runReaderProcess(status.paths.ffmpeg, ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=2:duration=21', '-an', '-c:v', 'mpeg4', movie]);
  const bytes = readFileSync(movie);
  input.record = { name: 'video.mp4', original: 'video.mp4', id: createHash('sha256').update(bytes).digest('hex') };
  const result = await readDocument(input);
  assert.equal(result.coverage.visualSampled, true);
  assert.ok(result.coverage.samples.some((sample) => sample.timestampMs >= 10_000));
  assert.ok(result.images.length > 0);
  assert.ok(result.images.every((image) => result.pages.some((page) => page.page === image.page && page.anchor.startMs === image.timestampMs)));
  assert.equal(result.coverage.complete, true);
});

test('native multilingual Small transcribes fictional synthesized speech with timestamps', { skip: skip || process.platform !== 'win32', timeout: 180_000 }, async (t) => {
  const input = fixture(t, 'placeholder.txt', Buffer.from('fictional fixture')), wav = join(input.root, 'speech.wav');
  const script = `$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName System.Speech; $voice = New-Object System.Speech.Synthesis.SpeechSynthesizer; $voice.SetOutputToWaveFile('${wav.replaceAll("'", "''")}'); $voice.Speak('The school meeting is scheduled for Tuesday morning at ten oclock. This recording contains a fictional document test for Case Forge.'); $voice.Dispose()`;
  await runReaderProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')]);
  const bytes = readFileSync(wav);
  input.record = { name: 'speech.wav', original: 'speech.wav', id: createHash('sha256').update(bytes).digest('hex') };
  const result = await readDocument(input);
  assert.match(result.pages.map((page) => page.text).join(' '), /school meeting/i);
  assert.ok(result.pages.every((page) => page.anchor.kind === 'timestamp' && page.anchor.endMs > page.anchor.startMs));
  assert.equal(result.coverage.complete, true);
});
