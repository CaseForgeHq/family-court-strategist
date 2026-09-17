import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph } from '../lib/graph.js';
import { parseFrontmatter } from '../lib/frontmatter.js';
test('Windows line endings preserve dates, people and source metadata', () => {
  const value = parseFrontmatter('---\r\ndate: 2026-09-15\r\npeople: [alex, sam]\r\nsource_page: 2\r\n---\r\n# A note');
  assert.equal(value.data.date, '2026-09-15'); assert.deepEqual(value.data.people, ['alex', 'sam']); assert.equal(value.data.source_page, '2');
});
test('graph resolves explicit references, shared topics and source pages without inferring unrecorded links', () => {
  const notes = [
    { file: '/case/people/alex.md', title: 'Alex', data: { type: 'person' }, body: '' },
    { file: '/case/event.md', title: 'An event', data: { event_id: 'EVT-1', date: '2026-09-15', people: ['alex', 'missing'], issue: ['contact'], source_file: '.strategist/documents/abc/original.pdf', source_name: 'Letter.pdf', source_page: '2' }, body: '[[people/alex|Alex]]' },
    { file: '/case/unlinked.md', title: 'Alex attended', data: {}, body: 'Alex is mentioned but no link is recorded.' },
  ];
  const graph = buildGraph(notes, '/case');
  assert.ok(graph.edges.some((e) => e.source === 'event.md' && e.target === 'people/alex.md'));
  assert.ok(graph.edges.some((e) => e.label === 'Cites source · page 2'));
  assert.ok(graph.edges.some((e) => e.target === 'topic:contact'));
  assert.ok(!graph.edges.some((e) => e.source === 'unlinked.md'));
  assert.equal(graph.unresolvedLinks.length, 1);
});
test('ambiguous note names remain unresolved; template and system notes stay out of the graph', () => {
  const notes = [
    { file: '/case/a/alex.md', title: 'Alex', data: {}, body: '' },
    { file: '/case/b/alex.md', title: 'Alex', data: {}, body: '' },
    { file: '/case/event.md', title: 'Event', data: {}, body: '[[alex]]' },
    { file: '/case/_templates/example.md', title: 'Template', data: {}, body: '[[alex]]' },
  ];
  const graph = buildGraph(notes, '/case');
  assert.equal(graph.edges.length, 0); assert.equal(graph.unresolvedLinks[0].reason, 'Ambiguous reference'); assert.equal(graph.nodes.length, 3);
});
