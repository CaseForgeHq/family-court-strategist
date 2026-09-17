import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { layoutGraph3D, flightStep } from '../public/map-layout.js';
import { createCaseMap } from '../public/graph.js';

test('3D layout is stable across node order, spatial and finite for empty, single and dense cases', () => {
  for (const count of [0, 1, 12, 120]) {
    const nodes = Array.from({ length: count }, (_, i) => ({ id: `record-${i}` }));
    const edges = nodes.slice(1).map(n => ({ source: nodes[0].id, target: n.id }));
    const result = layoutGraph3D({ nodes, edges });
    assert.deepEqual(result, layoutGraph3D({ nodes: [...nodes].reverse(), edges }));
    assert.equal(result.size, count);
    for (const point of result.values()) for (const key of ['x', 'y', 'z']) assert.ok(Number.isFinite(point[key]) && Math.abs(point[key]) < 1500);
    if (count > 1) assert.ok(new Set([...result.values()].map(p => p.z.toFixed(2))).size > 1, 'actual depth, not a flat plane');
  }
});

test('flight speed normalizes diagonals and limits long or negative frame gaps', () => {
  const forward = flightStep(new Set(['KeyW']), 1 / 60), diagonal = flightStep(new Set(['KeyW', 'KeyD', 'KeyE']), 1 / 60);
  assert.ok(forward.z < 0);
  assert.ok(Math.abs(Math.hypot(...Object.values(forward)) - Math.hypot(...Object.values(diagonal))) < 1e-8);
  assert.deepEqual(flightStep(new Set(['KeyW', 'KeyS']), .01), { x: 0, y: 0, z: 0 });
  assert.deepEqual(flightStep(new Set(['KeyW']), 9), flightStep(new Set(['KeyW']), .05));
  assert.equal(flightStep(new Set(['KeyE']), -2).y, 0);
});

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
function fixture(t) {
  const dom = new JSDOM('<main id="view"></main>');
  dom.window.WebGL2RenderingContext = function () {};
  t.after(() => dom.window.close());
  return { dom, host: dom.window.document.querySelector('main') };
}
function rendererModule(log, callbacks) {
  return { createMapScene(_host, options) {
    Object.assign(callbacks, options);
    return { update(graph) { log.push(['update', graph.nodes.length, graph.edges.length]); }, setSelected(id) { log.push(['selected', id]); }, pause(value) { log.push(['pause', value]); }, dispose() { log.push(['dispose']); }, snapshot() { return {}; } };
  } };
}
test('3D limits preserve all list records and dispose the renderer when leaving', async t => {
  const { host } = fixture(t), log = [], callbacks = {};
  const map = createCaseMap({ loadScene: async () => rendererModule(log, callbacks) }); t.after(() => map.unmount());
  map.mount(host, { graph: { nodes: Array.from({ length: 125 }, (_, i) => ({ id: `n${i}`, label: `Note ${i}`, type: 'note' })), edges: [] } });
  await flush();
  assert.ok(log.some(call => call[0] === 'update' && call[1] === 120));
  const updateCount = log.filter(call => call[0] === 'update').length;
  callbacks.onSelect('n1');
  assert.equal(log.filter(call => call[0] === 'update').length, updateCount, 'selecting a visible record preserves the camera and scene');
  assert.equal(host.querySelector('#map-limit'), null);
  host.querySelector('[data-map-mode="list"]').click();
  assert.equal(host.querySelectorAll('.map-items li').length, 125);
  assert.equal(host.querySelector('#map-limit'), null);
  assert.deepEqual(log.at(-1), ['pause', true]);
  host.querySelector('[data-map-mode="map"]').click();
  assert.deepEqual(log.at(-1), ['pause', false]);
  callbacks.onUnavailable();
  assert.equal(host.querySelector('#map-list').hidden, false);
  assert.equal(host.querySelector('#map-fallback').hidden, false);
  assert.equal(log.filter(c => c[0] === 'dispose').length, 1);
  map.unmount(); assert.equal(log.filter(c => c[0] === 'dispose').length, 1);
});
test('delayed renderer cannot mount into a different page; load failure leaves records usable', async t => {
  const { host } = fixture(t), log = []; let complete;
  const map = createCaseMap({ loadScene: () => new Promise(resolve => { complete = resolve; }) });
  map.mount(host, { graph: { nodes: [{ id: 'a', label: 'Alice' }], edges: [] } });
  map.unmount(); host.textContent = 'Other page'; complete(rendererModule(log, {})); await flush();
  assert.equal(host.textContent, 'Other page'); assert.deepEqual(log, []);
  const broken = createCaseMap({ loadScene: async () => { throw new Error('GPU not available'); } }); t.after(() => broken.unmount());
  broken.mount(host, { graph: { nodes: [{ id: 'a', label: 'Alice' }], edges: [] } }); await flush();
  assert.equal(host.querySelector('#map-fallback').hidden, false);
  host.querySelector('[data-map-select="a"]').click(); assert.equal(host.querySelector('#map-details h2').textContent, 'Alice');
});
