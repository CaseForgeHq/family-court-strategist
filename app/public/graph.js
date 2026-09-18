import { icon } from './icons.js';
import { makeWindow } from './windows.js';
// Layout distance and node colour never represent evidence strength or likelihood.
const TYPES = { person: "Person", event: "Event", pattern: "Pattern", evidence: "Claim", document: "Document", tag: "Topic", note: "Note" };
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const strings = (value) => (Array.isArray(value) ? value : value ? [value] : []).filter((s) => typeof s === "string");
export function normaliseGraph(model = {}) {
  let raw = model.graph;
  if (!raw || !Array.isArray(raw.nodes)) {
    // Older case models can still be viewed, but contain no relationship data.
    const nodes = [
      ...(model.timeline || []).map((n, i) => ({ id: `event:${i}:${n.eventId}`, type: "event", label: n.title, reference: n.eventId, date: n.date })),
      ...(model.people || []).map((n, i) => ({ id: `person:${i}`, type: "person", label: n.name, role: n.role })),
      ...(model.patterns || []).map((n, i) => ({ id: `pattern:${i}`, type: "pattern", label: n.name })),
      ...(model.evidence || []).map((n, i) => ({ id: `evidence:${i}`, type: "evidence", label: n.claim, source: n.source })),
    ];
    raw = { nodes, edges: [] };
  }
  const seen = new Set();
  const nodes = raw.nodes.filter((n) => n && typeof n.id === "string" && n.id && !seen.has(n.id) && seen.add(n.id)).map((n) => ({
    id: n.id, label: String(n.label || n.title || n.name || n.id), type: Object.hasOwn(TYPES, n.type) ? n.type : "note",
    reference: String(n.reference || n.path || n.file || ""), date: String(n.date || ""), role: String(n.role || ""),
    source: typeof n.source === "string" ? n.source : "", tags: strings(n.tags),
    sources: (Array.isArray(n.sources) ? n.sources : []).map((s) => typeof s === "string" ? s : [s.name || s.file, s.page ? `page ${s.page}` : ""].filter(Boolean).join(" · ")).filter(Boolean),
  }));
  const edgeIds = new Set();
  const edges = (raw.edges || []).filter((e) => e && seen.has(e.source) && seen.has(e.target) && e.source !== e.target).map((e) => ({
    source: e.source, target: e.target, label: String(e.label || e.type || "Recorded link"),
  })).filter((e) => {
    const key = JSON.stringify([e.source, e.target, e.label]);
    if (edgeIds.has(key)) return false;
    edgeIds.add(key); return true;
  });
  return { nodes, edges, unresolvedLinks: Array.isArray(raw.unresolvedLinks) ? raw.unresolvedLinks.length : Number(raw.unresolvedLinks) || 0 };
}

export function filterGraph(graph, query = "", type = "all") {
  const text = query.trim().toLowerCase();
  const nodes = graph.nodes.filter((n) => (type === "all" || n.type === type) && (!text || [n.label, n.reference, n.source, n.date, ...n.tags, ...n.sources].join(" ").toLowerCase().includes(text)));
  const ids = new Set(nodes.map((n) => n.id));
  return { nodes, edges: graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target)) };
}

export function createCaseMap({ openRecord, onSelect, loadScene = () => import('./map-scene.js') } = {}) {
  let detailWindow, browseOpen = false, connectedOnly = false, renderedGraphKey = '';
  let host, graph, scene, selected, query, type, viewMode, generation = 0, available = true, disposeEvents = () => {};
  const find = selector => host?.querySelector(selector);
  function unmount() { detailWindow?.destroy(); detailWindow = null; generation++; disposeEvents(); disposeEvents = () => {}; scene?.dispose(); scene = null; host = null; }
  function details() {
    const node = graph.nodes.find(n => n.id === selected), target = find('#map-details');
    target.hidden = !node;
    find('.map-layout').dataset.details = String(!!node);
    if (!node) { target.querySelector('.window-body').replaceChildren(); return; }
    const links = graph.edges.filter(e => e.source === node.id || e.target === node.id);
    target.querySelector('.window-body').innerHTML = `<div class="map-detail-heading"><p class="eyebrow">${TYPES[node.type]}</p><button class="icon-button" data-map-close type="button" aria-label="Close record details">${icon('close')}</button></div><h2>${escapeHtml(node.label)}</h2>
      ${node.date ? `<p class="map-date">${escapeHtml(node.date)}</p>` : ''}${node.role ? `<p>${escapeHtml(node.role)}</p>` : ''}
      <div class="map-record-actions">${openRecord && node.type !== 'tag' ? `<button type="button" class="record-link" data-map-open="${escapeHtml(node.id)}">Open record ${icon('arrowRight')}</button>` : ''}${viewMode === 'map' ? `<button class="map-action" type="button" data-map-focus>${icon('focus')} Focus</button>` : ''}</div>
      <button class="btn map-neighbours" type="button" data-map-neighbours aria-pressed="${connectedOnly}">${icon('map')} ${connectedOnly ? 'Show all records' : 'Only these connections'}</button><h3>Source reference</h3><p class="map-reference">${escapeHtml(node.reference || (node.type === 'tag' ? 'Topic recorded in linked notes' : 'No note reference recorded'))}</p>
      ${[node.source, ...node.sources].filter(Boolean).map(source => `<p class="map-reference">${escapeHtml(source)}</p>`).join('')}
      <h3>${links.length} recorded connection${links.length === 1 ? '' : 's'}</h3>
      ${links.length ? `<ul class="map-connections">${links.map(edge => { const other = graph.nodes.find(n => n.id === (edge.source === node.id ? edge.target : edge.source)); return `<li><button type="button" data-map-select="${escapeHtml(other.id)}"><small>${escapeHtml(edge.label)}</small><span>${escapeHtml(other.label)}</span>${icon('arrowRight')}</button></li>`; }).join('')}</ul>` : '<p>No connections recorded yet.</p>'}
      <p class="map-caution">A recorded link does not verify a claim. Position and distance have no meaning.</p>`;
  }
  function choose(id, { notify = true } = {}) {
    selected = id; if (!id) connectedOnly = false;
    render(); scene?.setSelected(id); details();
    browseOpen = false; renderPicker();
    host.querySelectorAll('#map-list [data-map-select]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mapSelect === id)));
    if (notify) onSelect?.(selected);
  }
  function select(id) {
    if (!host || id !== null && !graph.nodes.some(node => node.id === id)) return false;
    if (id && !filterGraph(graph, query, type).nodes.some(node => node.id === id)) {
      query = ''; type = 'all'; connectedOnly = false;
      find('#map-search').value = ''; find('#map-type').value = 'all';
    }
    choose(id, { notify: false });
    return true;
  }
  function visibleGraph() {
    let base = graph;
    if (connectedOnly && selected) { const links = graph.edges.filter(e => e.source === selected || e.target === selected), neighbours = new Set([selected,...links.flatMap(e => [e.source,e.target])]); base = { nodes: graph.nodes.filter(n => neighbours.has(n.id)), edges: links }; }
    const filtered = filterGraph(base, query, type), nodes = filtered.nodes.slice(0, 120);
    const active = filtered.nodes.find(n => n.id === selected); if (active && !nodes.some(n => n.id === selected)) nodes[nodes.length - 1] = active;
    const ids = new Set(nodes.map(n => n.id));
    return { filtered, visible: { nodes, edges: filtered.edges.filter(e => ids.has(e.source) && ids.has(e.target)) } };
  }
  function setMode(mode) {
    viewMode = mode;
    find('#map-map').hidden = mode !== 'map'; find('#map-list').hidden = mode !== 'list'; find('.map-controls').hidden = mode !== 'map';
    scene?.pause(mode !== 'map');
    host.querySelectorAll('[data-map-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mapMode === mode)));
    details();
  }
  function navigationMode(mode) {
    if (!host) return;
    find('[data-map-fly]').setAttribute('aria-pressed', String(mode === 'fly'));
    find('#map-navigation-hint').textContent = mode === 'fly' ? 'W A S D move · Q E up / down · Drag to look · Esc to stop' : 'Drag to orbit · Scroll to zoom · Right-drag to pan';
    find('#map-navigation-mode').textContent = mode === 'fly' ? 'Fly mode' : '3D space';
  }
  function render() {
    if (!host) return;
    const { filtered, visible } = visibleGraph();
    if (selected && !filtered.nodes.some(n => n.id === selected)) selected = null;
    find('#map-count').textContent = `${filtered.nodes.length} item${filtered.nodes.length === 1 ? '' : 's'} · ${filtered.edges.length} recorded connection${filtered.edges.length === 1 ? '' : 's'}`;
    find('#map-empty').hidden = !!visible.nodes.length;
    find('#map-empty').innerHTML = `<h2>${graph.nodes.length ? 'No matching items' : 'Your map starts with your records.'}</h2><p>${graph.nodes.length ? 'Try another name or choose all item types.' : 'Add files and save reviewed findings to see their recorded connections.'}</p>${graph.nodes.length ? '' : '<button class="btn primary" data-go="documents" type="button">Add files</button>'}`;
    find('#map-list').innerHTML = filtered.nodes.length ? `<ul class="map-items">${filtered.nodes.map(node => `<li><button type="button" data-map-select="${escapeHtml(node.id)}" aria-pressed="${node.id === selected}"><span class="map-dot type-${node.type}" aria-hidden="true"></span><span><strong>${escapeHtml(node.label)}</strong><small>${TYPES[node.type]}${node.reference ? ` · ${escapeHtml(node.reference)}` : ''}</small></span>${icon('arrowRight')}</button></li>`).join('')}</ul>` : '<p class="map-empty">No matching records. Add files or try another search.</p>';
    host.querySelectorAll('[data-map-kind]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mapKind === type)));
    const nextGraphKey = JSON.stringify([visible.nodes.map(n => n.id), visible.edges]);
    if (scene && nextGraphKey !== renderedGraphKey) { scene.update(visible); renderedGraphKey = nextGraphKey; }
    scene?.setSelected(selected);
    host.querySelectorAll('.map-controls button').forEach(button => { button.disabled = !scene || !visible.nodes.length; });
    setMode(viewMode);
  }
  function renderPicker() {
    const picker = find('#map-picker'); picker.hidden = !browseOpen;
    find('[data-map-browse]').setAttribute('aria-expanded', String(browseOpen));
    if (!browseOpen) return;
    const nodes = filterGraph(graph, query, type).nodes;
    picker.innerHTML = nodes.length ? nodes.map(node => `<button type="button" data-map-select="${escapeHtml(node.id)}"><i class="map-dot type-${node.type}"></i><span>${escapeHtml(node.label)}</span><small>${TYPES[node.type]}${node.date ? ' · '+escapeHtml(node.date) : ''}</small>${icon('arrowRight')}</button>`).join('') : '<p>No matching records. Try another name or file.</p>';
  }
  function fallback() {
    if (!host) return;
    available = false; scene?.dispose(); scene = null;
    find('#map-fallback').hidden = false; find('[data-map-mode="map"]').disabled = true;
    setMode('list');
  }
  function mount(element, model) {
    unmount(); host = element; const mountedGeneration = generation;
    graph = normaliseGraph(model); renderedGraphKey = ''; browseOpen = false; connectedOnly = false; query = ''; type = 'all'; selected = null; viewMode = 'map'; available = true;
    host.innerHTML = `<div class="case-map-shell"><div class="page-purpose"><p>Explore connections: search for a record or select a point.</p></div>
      <div class="map-tools"><label class="map-search-label">${icon('search')}<input id="map-search" aria-label="Search your map" type="search" placeholder="Find a person, event or file…" autocomplete="off"></label><button class="btn" type="button" data-map-browse aria-expanded="false">${icon('list')} Records</button><select id="map-type" aria-label="Show item type" hidden><option value="all">All item types</option>${Object.entries(TYPES).map(([key, value]) => `<option value="${key}">${value}</option>`).join('')}</select><span id="map-count" role="status" aria-live="polite"></span><div class="map-view-switch" aria-label="Map display"><button type="button" data-map-mode="map" aria-pressed="true">${icon('space')} 3D</button><button type="button" data-map-mode="list" aria-pressed="false">${icon('list')} List</button></div></div>
      <div class="map-legend-top" aria-label="Filter records by type"><button type="button" data-map-kind="all" aria-pressed="true">All</button>${Object.entries(TYPES).filter(([key]) => graph.nodes.some(n => n.type === key)).map(([key,label]) => `<button type="button" data-map-kind="${key}" aria-pressed="false"><i class="map-dot type-${key}" aria-hidden="true"></i>${label}</button>`).join('')}<span>Recorded links · position has no meaning</span></div><div id="map-picker" class="map-picker" aria-label="Choose a record" hidden></div><p id="map-fallback" class="map-notice" hidden>3D is unavailable on this device. Your records and connections are available in List.</p>
      <div class="map-layout" data-details="false"><section class="map-stage" id="map-stage" aria-label="Case connections">
        <div id="map-map"><div id="map-viewport"></div><div class="map-space-heading"><span id="map-navigation-mode">3D space</span><span>Select a point to follow its connections</span></div><div id="map-empty" class="map-empty" hidden></div></div><div id="map-list" hidden></div>
        <div class="map-controls"><span id="map-navigation-hint">Drag to orbit · Scroll to zoom · Right-drag to pan</span><div class="map-control-actions"><button type="button" data-map-fly aria-pressed="false">${icon('fly')} Fly</button><span class="map-control-separator"></span><button type="button" data-map-zoom="out" aria-label="Zoom out">${icon('minus')}</button><button type="button" data-map-zoom="in" aria-label="Zoom in">${icon('plus')}</button><button type="button" data-map-zoom="reset">${icon('reset')} Reset view</button></div></div>
      </section><aside class="map-details" id="map-details" aria-label="Selected item details" aria-live="polite" hidden><div class="window-body"></div></aside></div>

      ${graph.unresolvedLinks ? `<p class="map-unresolved">${graph.unresolvedLinks} recorded link${graph.unresolvedLinks === 1 ? ' points' : 's point'} to a note that could not be matched. Those connections are not drawn.</p>` : ''}
    </div>`;
    detailWindow = makeWindow(find('#map-details'), { title: 'Selected record', anchor: find('#map-stage'), onClose: () => choose(null) });
    const onInput = event => {
      if (event.target.id === 'map-search' && event.type === 'input') { query = event.target.value; connectedOnly = false; browseOpen = !!query; render(); renderPicker(); }
      if (event.target.id === 'map-type' && event.type === 'change') { type = event.target.value; render(); }
    };
    const onClick = event => {
      const kind = event.target.closest('[data-map-kind]'); if (kind) { type = kind.dataset.mapKind; connectedOnly = false; find('#map-type').value = type; render(); if (browseOpen) renderPicker(); }
      if (event.target.closest('[data-map-browse]')) { browseOpen = !browseOpen; renderPicker(); }
      if (event.target.closest('[data-map-neighbours]')) { connectedOnly = !connectedOnly; query = ''; type = 'all'; find('#map-search').value = ''; find('#map-type').value = 'all'; render(); }

      const open = event.target.closest('[data-map-open]'); if (open) { openRecord?.('note', open.dataset.mapOpen); return; }
      const item = event.target.closest('[data-map-select]');
      if (item) {
        const fromDetails = !!item.closest('#map-details'), id = item.dataset.mapSelect;
        if (fromDetails && !visibleGraph().visible.nodes.some(n => n.id === id)) {
          query = ''; type = 'all'; find('#map-search').value = ''; find('#map-type').value = 'all'; render();
          if (!visibleGraph().visible.nodes.some(n => n.id === id)) setMode('list');
        }
        choose(id);
        if (fromDetails) { const heading = find('#map-details h2'); heading.tabIndex = -1; heading.focus(); }
      }
      const modeButton = event.target.closest('[data-map-mode]'); if (modeButton && !modeButton.disabled) setMode(modeButton.dataset.mapMode);
      const zoom = event.target.closest('[data-map-zoom]'); if (zoom) zoom.dataset.mapZoom === 'reset' ? scene?.reset() : scene?.zoom(zoom.dataset.mapZoom);
      if (event.target.closest('[data-map-fly]') && available) { scene?.setMode(find('[data-map-fly]').getAttribute('aria-pressed') === 'true' ? 'orbit' : 'fly'); scene?.focusCanvas(); }
      if (event.target.closest('[data-map-focus]')) { scene?.focus(); scene?.focusCanvas(); }
      if (event.target.closest('[data-map-close]')) { choose(null); scene?.focusCanvas(); }
    };
    const onKey = event => {
      if (event.key === 'Escape' && browseOpen) { event.preventDefault(); browseOpen = false; renderPicker(); find('#map-search').focus(); }
      if (event.target.id === 'map-search' && ['ArrowDown', 'Enter'].includes(event.key) && browseOpen) { event.preventDefault(); const first = find('#map-picker [data-map-select]'); if (event.key === 'Enter') first?.click(); else first?.focus(); }
    };
    host.addEventListener('input', onInput); host.addEventListener('change', onInput); host.addEventListener('click', onClick); host.addEventListener('keydown', onKey);
    const ownedHost = host; disposeEvents = () => { ownedHost.removeEventListener('input', onInput); ownedHost.removeEventListener('change', onInput); ownedHost.removeEventListener('click', onClick); ownedHost.removeEventListener('keydown', onKey); };
    render();
    // Avoid probing canvas on devices without WebGL (also provides a real text alternative).
    if (!element.ownerDocument.defaultView.WebGL2RenderingContext) { fallback(); return; }
    loadScene().then(module => {
      if (!host || mountedGeneration !== generation) return;
      scene = module.createMapScene(find('#map-viewport'), { onSelect: choose, onUnavailable: fallback, onModeChange: navigationMode });
      render();
    }).catch(() => { if (host && mountedGeneration === generation) fallback(); });
  }
  return { mount, unmount, select, snapshot: () => scene?.snapshot() || null };
}

