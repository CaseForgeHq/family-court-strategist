import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyseDocument, CHECKS } from '../lib/scan-analysis.js';

const officialURL = 'https://www.legislation.gov.au/fictional-test-only';
const provisionText = 'A fictional person must retain the fictional appointment notice.';
const versionEvidence = 'Version in force from 2025-01-01 to 2025-12-31.';
const lawText = `Fictional Notices Act 2025. Section 4. ${provisionText} ${versionEvidence} This source is a synthetic fixture for source matching and historical period validation; it is not real legislation.`;
const orientation = (extra = {}) => ({ summary: 'A fictional appointment notice.', documentType: 'Letter', regions: ['Commonwealth', 'QLD'], eventDates: ['2025-06-12'], needsClarification: false, reason: '', legalIssues: [], ...extra });
const reading = (extra = {}) => ({ summary: 'Fictional source read.', findings: [], transcriptions: [], contextUpdates: { regions: [], eventDates: [], legalIssues: [], needsClarification: false, reason: '' }, limitations: [], ...extra });
const source = (page = 1, quote = 'Fictional appointment on 12 June 2025.') => ({ page, quote, basis: 'text', speaker: 'Fictional author', recipient: 'Fictional recipient', reportingSource: 'Fictional letter', sequence: '1' });
const finding = (extra = {}) => ({ kind: 'fact', title: 'Appointment date stated', detail: 'The letter states an appointment date.', strength: 'limited', limitations: 'This establishes only what the letter says.', sources: [source()], ...extra });
const law = (extra = {}) => ({ url: officialURL, title: 'Fictional Notices Act 2025', provision: 'Section 4', text: provisionText, relevance: 'Potential relevance to the fictional notice.', version: 'Fictional 2025 version', effectiveFrom: '2025-01-01', effectiveTo: '2025-12-31', versionEvidence, assumptions: ['Fictional test only.'], ...extra });

function fixture(t, options = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'caseforge-analysis-test-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const text = options.text || 'Fictional appointment on 12 June 2025.';
  const record = { id: createHash('sha256').update(text).digest('hex'), reference: 'CF-FICTIONAL-000001', name: 'fictional.txt', extension: '.txt' };
  const extraction = options.extraction || { pages: [{ page: 1, text, anchor: { kind: 'paragraph', paragraph: 1 } }], images: [], coverage: { complete: true }, reader: { name: 'Fictional UTF-8 fixture' } };
  const checkpoint = options.checkpoint || {}, calls = [], checkpoints = [], fetched = [], cache = new Map();
  const signal = options.signal || new AbortController().signal;
  const state = { read: 0 };
  const scan = async (input, scanOptions) => {
    assert.equal(scanOptions.signal, signal);
    const stage = input.text.includes('Understand the document before') ? 'orientation' : input.text.includes('Read this part of one document') ? 'reading' : input.text.includes('Suggest up to six official') ? 'candidates' : input.text.includes('Use only these retrieved official') ? 'law' : input.text.includes('Review the extracted record') ? 'diagnostics' : 'unknown';
    calls.push({ stage, ...input });
    let value = await options.respond?.(stage, input, state);
    if (value === undefined) value = stage === 'orientation' ? orientation(options.orientation) : stage === 'reading' ? reading({ findings: [finding()] }) : stage === 'candidates' ? { candidates: [{ url: officialURL, title: 'Fictional Notices Act 2025', provision: 'Section 4' }], limitations: [] } : stage === 'law' ? { laws: [law(options.law)], limitations: [] } : reading({ summary: 'Concise fictional result.' });
    if (stage === 'reading') state.read++;
    return { text: JSON.stringify(value), model: 'gpt-6-astra', effort: 'low', usage: { last: { inputTokens: 100, outputTokens: 20 } } };
  };
  const args = { root, record, extraction, jurisdiction: options.jurisdiction || { country: 'AU', regions: ['Commonwealth', 'QLD'], confirmed: true }, checkpoint, signal, requestId: 'fictional-request', scan,
    saveCheckpoint: async (stage, patch = {}) => { checkpoints.push({ stage, patch: structuredClone(patch) }); Object.assign(checkpoint, structuredClone(patch)); await options.saved?.(stage, checkpoint); },
    db: { call: async (method, { key, value }) => { assert.equal(method, 'law'); if (value) cache.set(key, value); return cache.get(key); } },
    fetchImpl: async (url, request) => { fetched.push({ url, request }); return new Response(lawText, { headers: { 'content-type': 'text/plain' } }); },
  };
  return { root, record, extraction, checkpoint, calls, checkpoints, fetched, args, run: () => analyseDocument(args) };
}

test('actual analysis reads context before facts, verifies law before diagnostics and returns all 13 checks', async t => {
  const f = fixture(t, { orientation: { legalIssues: ['record retention'] } });
  const result = await f.run();
  assert.deepEqual(f.calls.map(call => call.stage), ['orientation', 'reading', 'candidates', 'law', 'diagnostics']);
  assert.equal(result.complete, true); assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].sources[0].sourceMatch, 'text_match');
  assert.equal(result.laws[0].sourceMatch, 'official_text_match');
  assert.equal(result.laws[0].versionStatus, 'period_matched_requires_legal_review');
  assert.deepEqual(result.checks.map(check => check.label), CHECKS);
  assert.equal(result.usage.length, 5); assert.equal(f.fetched.length, 1);
  assert.equal(f.fetched[0].url, officialURL);
  assert.equal(f.fetched[0].request.redirect, 'manual');
  const discovery = f.calls.find(call => call.stage === 'candidates').text;
  assert.doesNotMatch(discovery, /Fictional author|Fictional recipient|Fictional appointment/);
  assert.match(discovery, /record retention/);
});

test('a complete text document without legal issues needs only orientation, reading and diagnostics', async t => {
  const f = fixture(t); const result = await f.run();
  assert.deepEqual(f.calls.map(call => call.stage), ['orientation', 'reading', 'diagnostics']);
  assert.equal(f.fetched.length, 0); assert.equal(result.complete, true); assert.deepEqual(result.laws, []); assert.deepEqual(result.attention, []);
});

test('resume reuses completed orientation and readings without another source-reading request', async t => {
  let interrupted = false;
  const f = fixture(t, { saved: async stage => { if (!interrupted && stage.startsWith('2–4 · Read part')) { interrupted = true; throw new Error('Fictional interruption after durable reading'); } } });
  await assert.rejects(f.run(), /Fictional interruption/);
  assert.equal(f.checkpoint.reads.length, 1); assert.ok(f.checkpoint.orientation);
  f.calls.length = 0;
  const result = await f.run();
  assert.deepEqual(f.calls.map(call => call.stage), ['diagnostics']);
  assert.equal(result.complete, true); assert.equal(result.usage.length, 3);
});

test('later-page legal issues are incorporated before official legislation retrieval', async t => {
  const extraction = { pages: Array.from({ length: 7 }, (_, index) => ({ page: index + 1, text: index === 6 ? 'PRIVATE LATER PAGE. Fictional appointment on 12 June 2025.' : 'Fictional appointment on 12 June 2025.', anchor: { kind: 'page', page: index + 1 } })), images: [], coverage: { complete: true } };
  const f = fixture(t, { extraction, respond: stage => stage === 'reading' ? reading({ findings: [finding()], contextUpdates: { regions: ['QLD'], eventDates: ['2025-06-12'], legalIssues: ['record retention'], needsClarification: false, reason: '' } }) : undefined });
  const result = await f.run();
  assert.doesNotMatch(f.calls[0].text, /PRIVATE LATER PAGE/);
  assert.match(f.calls.find(call => call.stage === 'reading').text, /PRIVATE LATER PAGE/);
  assert.match(f.calls.find(call => call.stage === 'candidates').text, /record retention/);
  assert.equal(result.complete, true); assert.deepEqual(result.context.legalIssues, ['record retention']);
});

test('a jurisdiction conflict found during full reading retains facts and pauses legal conclusions', async t => {
  const f = fixture(t, { respond: stage => stage === 'reading' ? reading({ findings: [finding()], contextUpdates: { regions: ['NSW'], eventDates: ['2025-06-12'], legalIssues: ['record retention'], needsClarification: true, reason: 'The event took place in NSW.' } }) : undefined });
  const result = await f.run();
  assert.equal(result.complete, false); assert.equal(result.findings.length, 1);
  assert.match(result.attention.join(' '), /NSW/); assert.equal(f.fetched.length, 0);
  assert.equal(f.calls.some(call => call.stage === 'candidates'), false);
  assert.match(result.legalLimitations.join(' '), /Confirm jurisdiction/);
});

test('a visual-only photograph creates quote-free findings anchored to the supplied image', async t => {
  const f = fixture(t, { extraction: { pages: [], images: [{ path: '.case-forge/derived/photo.png', page: 1, anchor: { kind: 'image', image: 1 } }], coverage: { complete: true } }, respond: stage => stage === 'reading' ? reading({ transcriptions: [{ page: 1, text: '', status: 'visual_only' }], findings: [finding({ title: 'A red object is visible', detail: 'A red object is visible in the photograph.', sources: [{ ...source(1, ''), basis: 'visual_observation' }] })] }) : undefined });
  mkdirSync(join(f.root, '.case-forge', 'derived'), { recursive: true });
  writeFileSync(join(f.root, '.case-forge', 'derived', 'photo.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64'));
  const result = await f.run();
  assert.equal(result.complete, true); assert.equal(result.findings[0].sources[0].quote, '');
  assert.equal(result.findings[0].sources[0].sourceMatch, 'visual_observation');
  assert.deepEqual(result.findings[0].sources[0].anchor, { kind: 'image', image: 1 });
  assert.equal(f.calls.find(call => call.stage === 'reading').images[0], join(f.root, '.case-forge', 'derived', 'photo.png'));
});

test('invented source quotations fail before legal or diagnostic inference', async t => {
  const f = fixture(t, { respond: stage => stage === 'reading' ? reading({ findings: [finding({ sources: [source(1, 'This was never in the document.')] })] }) : undefined });
  await assert.rejects(f.run(), /quotation did not match its source/);
  assert.deepEqual(f.calls.map(call => call.stage), ['orientation', 'reading']);
  assert.equal(f.fetched.length, 0);
});

test('invented official-law quotations fail instead of becoming a saved legal finding', async t => {
  const f = fixture(t, { orientation: { legalIssues: ['record retention'] }, law: { text: 'This is absent from the official source.' } });
  await assert.rejects(f.run(), /legal quotation could not be matched/);
  assert.equal(f.calls.some(call => call.stage === 'diagnostics'), false);
});

test('diagnostic coverage limitations leave the sourced report in attention state', async t => {
  const f = fixture(t, { respond: stage => stage === 'diagnostics' ? reading({ summary: 'Document has a remaining ambiguity.', limitations: ['One stated role cannot be attributed reliably.'] }) : undefined });
  const result = await f.run();
  assert.equal(result.complete, false); assert.equal(result.summary, 'Document has a remaining ambiguity.');
  assert.match(result.attention.join(' '), /role cannot be attributed/);
  assert.equal(result.findings[0].sources[0].quote, 'Fictional appointment on 12 June 2025.');
});

test('unknown historical period remains review-required even when the provision text matches', async t => {
  const f = fixture(t, { orientation: { legalIssues: ['record retention'] }, law: { effectiveFrom: '', effectiveTo: '', versionEvidence: '' } });
  const result = await f.run();
  assert.equal(result.complete, false); assert.equal(result.laws[0].sourceMatch, 'official_text_match');
  assert.equal(result.laws[0].versionStatus, 'needs_date_or_version_review');
  assert.match(result.attention.join(' '), /historical versions/);
});

test('an unresolved legal issue prevents completion even when another provision is source matched', async t => {
  const f = fixture(t, { orientation: { legalIssues: ['record retention'] }, respond: stage => stage === 'law' ? { laws: [law()], limitations: ['The separate filing rule could not be confirmed.'] } : undefined });
  const result = await f.run();
  assert.equal(result.complete, false); assert.equal(result.laws[0].versionStatus, 'period_matched_requires_legal_review');
  assert.match(result.attention.join(' '), /separate filing rule/);
});

test('an impossible event date cannot establish that a historical law version applies', async t => {
  const f = fixture(t, { orientation: { legalIssues: ['record retention'], eventDates: ['2025-02-31'] } });
  const result = await f.run();
  assert.equal(result.complete, false);
  assert.notEqual(result.laws[0].versionStatus, 'period_matched_requires_legal_review');
});

test('an impossible compilation date stays review-required without crashing the analysis', async t => {
  const f = fixture(t, { orientation: { legalIssues: ['record retention'] }, law: { effectiveFrom: '2025-13-01' } });
  const result = await f.run();
  assert.equal(result.complete, false);
  assert.equal(result.laws[0].versionStatus, 'needs_date_or_version_review');
});
