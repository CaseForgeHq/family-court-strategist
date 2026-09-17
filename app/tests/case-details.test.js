import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createCaseDetails, queryCaseGraph, compactCaseGraph } from '../public/case-details.js';
import { createCaseMap, normaliseGraph } from '../public/graph.js';

const model = { caseName: 'Fictional arrangements', graph: { nodes: [
  { id: 'people/alex.md', label: 'Alex Morgan', type: 'person', role: 'Parent', reference: 'people/alex.md' },
  { id: 'events/pickup.md', label: 'School collection', type: 'event', date: '2026-09-17', reference: 'EVT-002' },
  { id: 'source:emails/collection.txt', label: 'Collection email', type: 'document', reference: 'CF-TEST-000001', sources: ['Message 3'] },
  { id: 'people/sam.md', label: 'Sam Morgan', type: 'person', role: 'Parent' },
], edges: [
  { source: 'people/alex.md', target: 'events/pickup.md', label: 'Mentioned in' },
  { source: 'events/pickup.md', target: 'source:emails/collection.txt', label: 'Source' },
] } };

test('details query combines terms, phrases, type and recorded neighbours without adding links', () => {
  const graph = normaliseGraph(model);
  assert.deepEqual(queryCaseGraph(graph, { query: 'school 2026-09' }).map(node => node.id), ['events/pickup.md']);
  assert.deepEqual(queryCaseGraph(graph, { query: '"collection email"' }).map(node => node.id), ['source:emails/collection.txt']);
  assert.equal(queryCaseGraph(graph, { query: 'CF-TEST', type: 'person' }).length, 0);
  assert.deepEqual(queryCaseGraph(graph, { type: 'person', selected: 'events/pickup.md', connected: true }).map(node => node.id), ['people/alex.md']);
  assert.equal(queryCaseGraph(graph, { query: 'parent' }).length, 2);
  const compact = compactCaseGraph(graph, 'events/pickup.md', 2);
  assert.equal(compact.nodes.length, 2);
  assert.equal(compact.omitted, 1);
  assert.deepEqual(compact.edges, [graph.edges[0]]);
  assert.deepEqual(compactCaseGraph(graph, 'missing'), { nodes: [], edges: [], omitted: 0 });
});

function fixture(t, options = {}) {
  const dom = new JSDOM('<aside id="panel-details"></aside><div id="panel-ai" hidden></div><main id="view"></main>');
  const host = dom.window.document.querySelector('aside');
  const details = createCaseDetails(options); details.mount(host); details.update(model, 'case-a');
  t.after(() => { details.unmount(); dom.window.close(); });
  const input = (selector, value, event = 'input') => {
    const element = host.querySelector(selector); element.value = value; element.dispatchEvent(new dom.window.Event(event, { bubbles: true })); return element;
  };
  return { dom, host, details, input };
}

test('details persists query, selected record and scroll through tabs and same-case model updates; resets for another case', t => {
  const { host, details, input } = fixture(t);
  details.select('events/pickup.md');
  const query = input('#case-details-query', 'Morgan');
  input('#case-details-type', 'person', 'change');
  host.querySelector('.case-details-body').scrollTop = 145;
  host.hidden = true; host.hidden = false;
  details.update({ ...model, caseName: 'Renamed case' }, 'case-a');
  assert.equal(host.querySelector('#case-details-query'), query, 'search input remains mounted');
  assert.equal(query.value, 'Morgan');
  assert.equal(host.querySelector('#case-details-type').value, 'person');
  assert.equal(host.querySelector('.case-details-body').scrollTop, 145);
  assert.equal(details.getSelection(), 'events/pickup.md');
  assert.equal(host.querySelector('.case-details-selection h3').textContent, 'School collection');
  assert.equal(host.querySelector('#case-details-count').textContent, '2 matching records');
  details.update({ caseName: 'Another case', graph: { nodes: [], edges: [] } }, 'case-b');
  assert.equal(query.value, '');
  assert.equal(host.querySelector('#case-details-type').value, 'all');
  assert.equal(details.getSelection(), null);
  assert.equal(host.querySelector('.case-details-body').scrollTop, 0);
  assert.equal(host.querySelector('.case-details-selection').hidden, true);
  assert.match(host.textContent, /Another case/);
  assert.doesNotMatch(host.textContent, /School collection|Alex Morgan/);
});

test('keyboard search, recorded links, file opening and full-map actions keep source identifiers', t => {
  const calls = [], { host, input, dom, details } = fixture(t, { openRecord: (...args) => calls.push(['open', ...args]), openMap: id => calls.push(['map', id]), onSelect: id => calls.push(['select', id]) });
  const query = input('#case-details-query', 'collection email');
  query.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  assert.equal(details.getSelection(), 'source:emails/collection.txt');
  assert.equal(dom.window.document.activeElement, host.querySelector('.case-details-selection h3'));
  host.querySelector('[data-detail-open]').click();
  host.querySelector('.case-details-record-actions [data-detail-map]').click();
  assert.deepEqual(calls, [['select', 'source:emails/collection.txt'], ['open', 'note', 'source:emails/collection.txt'], ['map', 'source:emails/collection.txt']]);
  host.querySelector('.case-details-links [data-detail-select]').click();
  assert.equal(details.getSelection(), 'events/pickup.md');
  assert.equal(query.value, 'collection email', 'following a connection preserves the query');
  host.querySelector('[data-detail-clear-query]').click();
  host.querySelector('[data-detail-connected]').click();
  assert.equal(host.querySelectorAll('.case-details-results li').length, 3);
  assert.equal(host.querySelectorAll('.case-details-map line').length, 2);
  host.querySelector('[data-detail-clear]').click();
  assert.equal(host.querySelector('[data-detail-connected]').disabled, true);
  assert.equal(host.querySelector('[data-detail-connected]').getAttribute('aria-pressed'), 'false');
});

test('source strings remain text and large graphs retain searchable records beyond the preview cap', t => {
  const { host, details, input } = fixture(t);
  const nodes = Array.from({ length: 85 }, (_, index) => ({ id: `n${index}`, label: index ? `Record ${index}` : '<img src=x onerror=alert(1)>', type: 'note' }));
  const edges = nodes.slice(1).map(node => ({ source: 'n0', target: node.id, label: '<script>alert(1)</script>' }));
  details.update({ graph: { nodes, edges } }, 'case-a'); details.select('n0');
  assert.equal(host.querySelectorAll('img,script').length, 0);
  assert.match(host.querySelector('.case-details-selection h3').textContent, /<img/);
  assert.equal(host.querySelectorAll('.case-details-point').length, 7);
  assert.equal(host.querySelectorAll('.case-details-map line').length, 6);
  assert.match(host.querySelector('#case-details-map-caption').textContent, /78 more/);
  assert.equal(host.querySelectorAll('.case-details-results li').length, 30);
  host.querySelector('[data-detail-more]').click();
  assert.equal(host.querySelectorAll('.case-details-results li').length, 60);
  input('#case-details-query', 'Record 84');
  assert.equal(host.querySelectorAll('.case-details-results li').length, 1);
  assert.equal(host.querySelector('.case-details-results [data-detail-select]').dataset.detailSelect, 'n84');
});

test('blurring an edited query keeps the pressed result mounted for its first click', t => {
  const { host, details, input, dom } = fixture(t);
  const query = input('#case-details-query', 'School');
  const result = host.querySelector('.case-details-results [data-detail-select]');
  result.dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true }));
  query.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.equal(result.isConnected, true, 'committing the search on blur must not remove the pressed button');
  result.click();
  assert.equal(details.getSelection(), 'events/pickup.md');
});

test('full map and compact details selection synchronize without recursive callbacks', t => {
  const { host, dom, details } = fixture(t);
  const selected = [], map = createCaseMap({ onSelect: id => { selected.push(id); details.select(id); } });
  t.after(() => map.unmount());
  const mapHost = dom.window.document.querySelector('main'); map.mount(mapHost, model);
  mapHost.querySelector('[data-map-select="events/pickup.md"]').click();
  assert.equal(details.getSelection(), 'events/pickup.md');
  assert.deepEqual(selected, ['events/pickup.md']);
  map.select('people/alex.md');
  assert.equal(mapHost.querySelector('#map-details h2').textContent, 'Alex Morgan');
  assert.deepEqual(selected, ['events/pickup.md'], 'programmatic synchronization does not emit another selection');
  assert.equal(map.select('missing'), false);
  assert.equal(host.querySelector('.case-details-selection h3').textContent, 'School collection');
});
