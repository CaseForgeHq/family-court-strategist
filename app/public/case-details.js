import { normaliseGraph } from './graph.js';
import { icon } from './icons.js';

const TYPES = { person: 'Person', event: 'Event', document: 'Document', evidence: 'Claim', pattern: 'Pattern', tag: 'Topic', note: 'Note' };
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

// Search only the records already present in the case map. No AI or inferred links.
export function queryCaseGraph(graph, { query = '', type = 'all', selected = null, connected = false } = {}) {
  const terms = (query.toLowerCase().match(/"[^"]+"|\S+/g) || []).map(term => term.replace(/^"|"$/g, ''));
  const neighbours = new Set([selected]);
  if (connected && selected) for (const edge of graph.edges) {
    if (edge.source === selected) neighbours.add(edge.target);
    if (edge.target === selected) neighbours.add(edge.source);
  }
  return graph.nodes.filter(node => {
    if (type !== 'all' && node.type !== type || connected && selected && !neighbours.has(node.id)) return false;
    const text = [node.label, node.reference, node.date, node.role, node.source, ...node.tags, ...node.sources].join(' ').toLowerCase();
    return terms.every(term => text.includes(term));
  });
}

export function compactCaseGraph(graph, focus, limit = 7) {
  const anchor = graph.nodes.find(node => node.id === focus);
  if (!anchor) return { nodes: [], edges: [], omitted: 0 };
  const ids = new Set([anchor.id]);
  for (const edge of graph.edges) {
    if (edge.source === anchor.id) ids.add(edge.target);
    if (edge.target === anchor.id) ids.add(edge.source);
  }
  const neighbours = graph.nodes.filter(node => node.id !== anchor.id && ids.has(node.id));
  const nodes = [anchor, ...neighbours.slice(0, Math.max(0, limit - 1))];
  const visible = new Set(nodes.map(node => node.id));
  return { nodes, edges: graph.edges.filter(edge => visible.has(edge.source) && visible.has(edge.target)), omitted: Math.max(0, neighbours.length - nodes.length + 1) };
}

export function createCaseDetails({ openRecord, openMap, onSelect } = {}) {
  let host, graph = { nodes: [], edges: [] }, caseKey, caseName = 'Your case', query = '', type = 'all', selected = null, connected = false, browseLimit = 30;
  const find = selector => host?.querySelector(selector);
  const selectedNode = () => graph.nodes.find(node => node.id === selected);

  function renderMap(focus) {
    const preview = compactCaseGraph(graph, focus);
    const points = new Map(preview.nodes.map((node, index) => {
      if (!index) return [node.id, { x: 50, y: 50 }];
      const angle = -Math.PI / 2 + (index - 1) * Math.PI * 2 / (preview.nodes.length - 1);
      return [node.id, { x: 50 + Math.cos(angle) * 35, y: 50 + Math.sin(angle) * 33 }];
    }));
    find('.case-details-map').innerHTML = preview.nodes.length ? `<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${preview.edges.map(edge => {
      const from = points.get(edge.source), to = points.get(edge.target);
      return `<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}"/>`;
    }).join('')}</svg>${preview.nodes.map(node => {
      const point = points.get(node.id);
      return `<button type="button" class="case-details-point${node.id === focus ? ' is-focus' : ''}" style="left:${point.x}%;top:${point.y}%" data-detail-select="${esc(node.id)}" aria-pressed="${node.id === selected}" aria-label="${esc(`${TYPES[node.type]}: ${node.label}`)}" title="${esc(node.label)}"><i class="map-dot type-${node.type}" aria-hidden="true"></i><span>${esc(node.label)}</span></button>`;
    }).join('')}` : '<p class="case-details-empty">Your recorded connections will appear here.</p>';
    find('#case-details-map-caption').textContent = preview.nodes.length ? `${preview.nodes.length} record${preview.nodes.length === 1 ? '' : 's'} in view${preview.omitted ? ` · ${preview.omitted} more connected` : ''}` : 'No records to show';
  }

  function renderSelection() {
    const node = selectedNode(), target = find('.case-details-selection');
    target.hidden = !node;
    if (!node) { target.replaceChildren(); return; }
    const links = graph.edges.filter(edge => edge.source === node.id || edge.target === node.id);
    target.innerHTML = `<div class="case-details-record-heading"><span class="case-details-kind">${TYPES[node.type]}</span><button type="button" class="icon-button" data-detail-clear aria-label="Clear selected record">${icon('close')}</button></div><h3 tabindex="-1">${esc(node.label)}</h3>${node.role || node.date ? `<p class="case-details-meta">${esc([node.role, node.date].filter(Boolean).join(' · '))}</p>` : ''}${node.reference ? `<p class="case-details-reference">${esc(node.reference)}</p>` : ''}${[node.source, ...node.sources].filter(Boolean).map(source => `<p class="case-details-reference">${esc(source)}</p>`).join('')}<div class="case-details-record-actions">${node.type !== 'tag' && openRecord ? `<button type="button" class="record-link" data-detail-open="${esc(node.id)}">Open record ${icon('arrowRight')}</button>` : ''}<button type="button" class="record-link" data-detail-map>View on case map ${icon('map')}</button></div><h4>${links.length} recorded connection${links.length === 1 ? '' : 's'}</h4>${links.length ? `<ul class="case-details-links">${links.map(edge => {
      const other = graph.nodes.find(item => item.id === (edge.source === node.id ? edge.target : edge.source));
      return `<li><button type="button" data-detail-select="${esc(other.id)}"><i class="map-dot type-${other.type}" aria-hidden="true"></i><span><strong>${esc(other.label)}</strong><small>${esc(edge.label)}</small></span>${icon('arrowRight')}</button></li>`;
    }).join('')}</ul>` : '<p class="case-details-empty">No connections recorded for this item.</p>'}`;
  }

  function render() {
    if (!host) return;
    const records = queryCaseGraph(graph, { query, type, selected, connected });
    find('#context-case-name').textContent = caseName;
    find('#case-details-summary').textContent = `${graph.nodes.length} record${graph.nodes.length === 1 ? '' : 's'} · ${graph.edges.length} connection${graph.edges.length === 1 ? '' : 's'}`;
    find('[data-detail-connected]').disabled = !selected;
    find('[data-detail-connected]').setAttribute('aria-pressed', String(connected));
    find('[data-detail-clear-query]').hidden = !query;
    find('#case-details-count').textContent = `${records.length} matching record${records.length === 1 ? '' : 's'}`;
    find('.case-details-results').innerHTML = records.length ? records.slice(0, browseLimit).map(node => `<li><button type="button" data-detail-select="${esc(node.id)}" aria-pressed="${node.id === selected}"><i class="map-dot type-${node.type}" aria-hidden="true"></i><span><strong>${esc(node.label)}</strong><small>${TYPES[node.type]}${node.date ? ` · ${esc(node.date)}` : ''}</small></span>${icon('arrowRight')}</button></li>`).join('') : `<li class="case-details-empty">${graph.nodes.length ? 'No matches. Try another name, date or reference.' : 'Add case records to start exploring their connections.'}</li>`;
    find('[data-detail-more]').hidden = records.length <= browseLimit;
    renderMap(selectedNode()?.id || records[0]?.id);
    renderSelection();
  }

  function select(id, { notify = false } = {}) {
    if (id !== null && !graph.nodes.some(node => node.id === id)) return false;
    selected = id;
    if (!selected) connected = false;
    render();
    if (notify) onSelect?.(selected);
    return true;
  }
  function input(event) {
    if (event.target.id === 'case-details-query' && event.type === 'input' && query !== event.target.value) { query = event.target.value; browseLimit = 30; render(); }
    if (event.target.id === 'case-details-type' && event.type === 'change' && type !== event.target.value) { type = event.target.value; browseLimit = 30; render(); }
  }
  function click(event) {
    const item = event.target.closest('[data-detail-select]');
    if (item) { select(item.dataset.detailSelect, { notify: true }); find('.case-details-selection h3')?.focus({ preventScroll: true }); return; }
    if (event.target.closest('[data-detail-clear]')) { select(null, { notify: true }); return; }
    if (event.target.closest('[data-detail-clear-query]')) { query = ''; find('#case-details-query').value = ''; render(); find('#case-details-query').focus(); }
    if (event.target.closest('[data-detail-connected]')) { connected = !connected; browseLimit = 30; render(); }
    if (event.target.closest('[data-detail-more]')) { browseLimit += 30; render(); }
    const open = event.target.closest('[data-detail-open]');
    if (open) openRecord?.('note', open.dataset.detailOpen);
    if (event.target.closest('[data-detail-map]')) openMap?.(selected);
  }
  function keydown(event) {
    if (event.target.id === 'case-details-query' && ['Enter', 'ArrowDown'].includes(event.key)) {
      event.preventDefault();
      const first = find('.case-details-results [data-detail-select]');
      if (event.key === 'Enter') first?.click(); else first?.focus();
    }
  }
  function mount(element) {
    if (host === element) return;
    unmount(); host = element;
    host.innerHTML = `<div class="case-details-header"><div><h2 id="context-case-name">Your case</h2><p id="case-details-summary"></p></div><button type="button" class="icon-button" data-detail-map aria-label="Open full case map" title="Open full case map">${icon('map')}</button></div><div class="case-details-tools"><label class="case-details-search">${icon('search')}<input id="case-details-query" type="search" aria-label="Search case map records" placeholder="Search names, dates or references…" autocomplete="off" maxlength="240"><button type="button" class="icon-button" data-detail-clear-query aria-label="Clear case map search" hidden>${icon('close')}</button></label><div class="case-details-filters"><select id="case-details-type" aria-label="Filter case map record type"><option value="all">All records</option>${Object.entries(TYPES).map(([key, label]) => `<option value="${key}">${label}</option>`).join('')}</select><button type="button" data-detail-connected aria-pressed="false" disabled>${icon('link')} Connected only</button></div></div><div class="case-details-body"><figure class="case-details-figure"><div class="case-details-map" role="group" aria-label="Recorded case connections"></div><figcaption id="case-details-map-caption"></figcaption></figure><section class="case-details-selection" aria-label="Selected case record" hidden></section><section class="case-details-browse" aria-label="Case map search results"><p id="case-details-count" role="status" aria-live="polite"></p><ul class="case-details-results"></ul><button type="button" class="btn small" data-detail-more hidden>Show more records</button></section><p class="case-details-caution">Recorded links only. Position does not indicate evidence strength.</p></div>`;
    host.addEventListener('input', input); host.addEventListener('change', input); host.addEventListener('click', click); host.addEventListener('keydown', keydown);
    render();
  }
  function update(model, key) {
    if (key !== caseKey) {
      caseKey = key; selected = null; query = ''; type = 'all'; connected = false; browseLimit = 30;
      if (host) { find('#case-details-query').value = ''; find('#case-details-type').value = 'all'; find('.case-details-body').scrollTop = 0; }
    }
    graph = normaliseGraph(model); caseName = model.caseName || 'Your case';
    if (selected && !selectedNode()) { selected = null; connected = false; }
    render();
  }
  function unmount() {
    if (!host) return;
    host.removeEventListener('input', input); host.removeEventListener('change', input); host.removeEventListener('click', click); host.removeEventListener('keydown', keydown); host = null;
  }
  return { mount, update, select, unmount, getSelection: () => selected };
}
