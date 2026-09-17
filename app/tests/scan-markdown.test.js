import { test } from 'node:test';
import assert from 'node:assert/strict';
import { posix } from 'node:path';
import { reportMarkdown } from '../lib/scan-analysis.js';

function fixture() {
  return {
    record: { id: 'document-1', reference: 'CF-FICTIONAL-000001', name: 'Fictional notice.pdf', extension: '.pdf', original: 'Evidence/Qld [draft] #1 (copy) 100%.pdf' },
    report: {
      id: 'report-1', documentId: 'document-1', schemaVersion: 1, createdAt: '2026-09-17T01:02:03Z', complete: false,
      model: 'gpt-6-astra', effort: 'low', summary: 'A fictional appointment notice.',
      context: { documentType: 'Letter', eventDates: ['2025-06-12'], regions: ['QLD'], legalIssues: ['record retention'], needsClarification: false },
      jurisdiction: { country: 'AU', regions: ['Commonwealth', 'QLD'], confirmed: true },
      attention: ['The historical version needs confirmation.'], legalLimitations: ['A second issue has no verified legal source.'],
      findings: [{ id: 'finding-1', kind: 'claim', title: 'Appointment stated', detail: 'The author reports an appointment.', strength: 'limited', limitations: 'This does not establish attendance.', sources: [{ documentId: 'document-1', page: 3, quote: 'An appointment was booked.\nPlease retain this notice.', speaker: 'Fictional author', recipient: null, reportingSource: 'Fictional letter', sequence: '2', anchor: { kind: 'page', page: 3, label: 'Page 3' }, sourceMatch: 'text_match' }] }],
      laws: [{ title: 'Fictional Notices Act 2025', provision: 'Section 4', text: 'Retain the fictional notice.', url: 'https://www.legislation.gov.au/fictional-test-only?version=(2025)', relevance: 'May apply to retention of this notice.', version: 'Fictional 2025 compilation', versionStatus: 'needs_date_or_version_review', effectiveFrom: '2025-01-01', effectiveTo: '2025-12-31', versionEvidence: 'In force from 1 January to 31 December 2025.', retrievedAt: '2026-09-17', sourceHash: 'fixture-hash', sourceMatch: 'official_text_match', assumptions: ['The recorded event date is accurate.'] }],
      coverage: { complete: false, extractedPages: 4, warnings: ['One faint stamp was unreadable.'] }, reader: { name: 'PDF.js', version: 'fictional' }, usage: [{ stage: 'reading', tokens: 120 }], errors: ['Fictional coverage warning.'],
    },
  };
}

test('Markdown preserves report identity, context, jurisdiction, evidence limits and legal version details', () => {
  const { report, record } = fixture(), result = reportMarkdown(report, record);
  assert.ok(result.startsWith('# Fictional notice.pdf\n\n- File number: CF-FICTIONAL-000001\n- Document ID: document-1\n- Report ID: report-1\n- Schema version: 1\n'));
  for (const expected of ['- Created: 2026-09-17T01:02:03Z', '- Model: gpt-6-astra · reasoning: low', '## Context and jurisdiction', '- Document Type: Letter', '- Event Dates:\n  - 2025-06-12', '- Country: AU', '- Regions:\n  - Commonwealth\n  - QLD', '- Finding ID: finding-1', '- Evidence strength: limited', 'This does not establish attendance.', '- Effective from: 2025-01-01', '- Effective to: 2025-12-31', 'The recorded event date is accurate.', 'A second issue has no verified legal source.', '- Extracted Pages: 4', 'One faint stamp was unreadable.', 'Fictional coverage warning.', 'Tags: #files-ai #unreviewed']) assert.ok(result.includes(expected), `Missing ${expected}`);
  assert.match(result, /Version evidence:\n\n> In force from 1 January to 31 December 2025\./);
  assert.match(result, /\[Official source\]\(https:\/\/www\.legislation\.gov\.au\/fictional-test-only\?version=%282025%29\)/);
  assert.doesNotMatch(result, /Report version:|undefined/);
  assert.equal(reportMarkdown({ ...report, context: Object.fromEntries(Object.entries(report.context).reverse()) }, record), result, 'Field insertion order does not change the saved representation');
});

test('Markdown source quotations retain attribution and original links resolve from the saved report folder', () => {
  const { report, record } = fixture(), result = reportMarkdown(report, record);
  assert.ok(result.includes('> An appointment was booked.\n> Please retain this notice.'));
  assert.ok(result.includes('- Speaker: Fictional author\n- Recipient: unknown\n- Reporting source: Fictional letter\n- Sequence: 2'));
  const target = result.match(/\[Open original at source\]\(([^)]+)\)/)?.[1];
  assert.ok(target); assert.ok(target.endsWith('#page=3'));
  assert.equal(posix.resolve('/case/.case-forge/derived/document-1/reports', decodeURIComponent(target.split('#')[0])), '/case/'+record.original);
  assert.match(target, /Qld%20%5Bdraft%5D%20%231%20%28copy%29%20100%25\.pdf/);
  const windowsRecord = { ...record, original: record.original.replaceAll('/', '\\') };
  assert.equal(reportMarkdown(report, windowsRecord), result);
});

test('visual observations are quote-free and link to the recording timestamp and sampled image', () => {
  const { report, record } = fixture();
  record.name = 'Fictional recording.mp4'; record.extension = '.mp4'; record.original = '.case-forge/originals/document-1/original.mp4';
  report.laws = []; report.sourceImages = [{ page: 2, path: '.case-forge/derived/document-1/frame [2].png' }];
  report.findings[0].sources = [{ documentId: 'document-1', page: 2, quote: '', sourceMatch: 'visual_observation', anchor: { kind: 'timestamp', startMs: 10500, endMs: 12000 } }];
  report.coverage = { complete: true, visualCoverage: 'Scene-change frames and regular 10-second samples; intermediate frames were not reviewed.' };
  const result = reportMarkdown(report, record);
  assert.match(result, /#t=10\.5\)/);
  assert.match(result, /\[View source image\]\(\.\.\/\.\.\/\.\.\/\.\.\/\.case-forge\/derived\/document-1\/frame%20%5B2%5D\.png\)/);
  assert.match(result, /Visual observation; no quotation recorded\./);
  assert.match(result, /intermediate frames were not reviewed/);
  assert.doesNotMatch(result, /^>/m);
});

test('Markdown safely renders source text and refuses unsafe local paths or non-HTTPS law links', () => {
  const { report, record } = fixture();
  record.name = '<img src=x> [fake](javascript:bad)'; report.laws[0].url = 'javascript:bad';
  report.findings[0].sources[0].quote = '<script>bad()</script> [do this](https://invalid.example)';
  for (const original of ['../other-case/source.pdf', 'C:\\Private\\source.pdf', 'https://outside.example/source.pdf', '/outside.pdf']) {
    const result = reportMarkdown(report, { ...record, original });
    assert.match(result, /Original link: unavailable/);
    assert.doesNotMatch(result, /\[Open original at source\]|\[Official source\]|<script>|<img/);
    assert.ok(result.includes('> &lt;script&gt;bad()&lt;/script&gt; \\[do this\\](https://invalid.example)'));
  }
});

test('partial or legacy Markdown tolerates missing optional fields without inventing completion or a version', () => {
  const result = reportMarkdown({ id: 'legacy-1', legacy: true, summary: 'Retained historical report.' }, { id: 'doc-1', name: 'legacy.txt' });
  assert.match(result, /Scan status: Legacy report/);
  assert.match(result, /Schema version: unknown/);
  assert.doesNotMatch(result, /Scan status: Completed|Report version:|undefined/);
});
