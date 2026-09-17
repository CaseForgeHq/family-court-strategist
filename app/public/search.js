import { icon } from './icons.js';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ICONS = { document:'file', note:'book', person:'people', event:'clock', evidence:'evidence', pattern:'patterns', research:'book', task:'tasks', journal:'notebook', notebook:'notebook', calendar:'calendar', fact:'evidence', draft:'ai' };
export function createSearch({ api, openRecord, go, desktop, getSession }) {
  const input = document.getElementById('search');
  let host = null, serial = 0, query = '', type = '', history = false, mode = 'all', offset = 0, data = null, pane = 'results', review = null, answer = null, personal = false, sending = false;
  const find = id => host?.querySelector(`#${id}`);
  function close() { /* Enter opens a full results page; there is no transient results popup. */ }
  function unmount() { serial++; host = null; if(sending) void desktop?.chatGPTCancel?.(); }
  function notice(message, error = false) { const node = find('index-notice'); if(node) { node.textContent = message; node.setAttribute('role', error ? 'alert' : 'status'); } }
  function shell() {
    if(!host) return;
    host.innerHTML = `<div class="page-purpose"><p>Find the detail. Follow the source.</p><span>Search saved text across this case. Local search includes your notebook and journal.</span></div><section class="search-workbench" aria-label="Case search"><div class="search-toolbar"><form id="case-search-form"><label class="index-query">${icon('search')}<input id="case-search-query" aria-label="Search this case" placeholder="A name, file number, phrase or date…" maxlength="300" value="${esc(query)}"></label><button class="btn primary" type="submit">Search ${icon('arrowRight')}</button></form><button type="button" class="btn" id="index-coverage">${icon('list')}Index coverage</button><button type="button" class="btn" id="deep-search">${icon('ai')}Search deeper with AI</button></div><div id="index-notice" role="status"></div><div id="search-pane"></div></section>`;
    find('case-search-form').addEventListener('submit', e => { e.preventDefault(); void submit(find('case-search-query').value); });
    find('index-coverage').addEventListener('click', () => { pane = 'coverage'; render(); });
    find('deep-search').addEventListener('click', () => { pane = 'deep'; render(); });
    render();
  }
  function resultRow(r) {
    return `<button type="button" class="index-result" data-result-key="${esc(r.key)}">${icon(ICONS[r.category] || 'file')}<span class="index-result-copy"><span class="index-result-heading"><strong>${esc(r.title)}</strong><span class="index-kind">${esc(data?.types?.[r.category] || r.category)}${r.history ? ' · Earlier version' : ''}</span></span><span class="index-result-meta">${esc(r.reference)} · ${esc(r.locator)} · ${esc(r.status)}</span><span class="index-excerpt">${esc(r.text)}</span></span>${icon('arrowRight')}</button>`;
  }
  function render() {
    const target = find('search-pane'); if(!target) return;
    host.dataset.searchPane = pane;
    find('deep-search').disabled = !query || sending;
    if(pane === 'coverage') {
      const c = data?.coverage;
      target.innerHTML = `<div class="index-subheading"><h2>Your local index</h2><button type="button" class="btn" data-back>Back to results</button></div><div class="index-scroll coverage-content">${c ? `<p>${c.current} current records · ${c.historical} earlier revisions · ${c.links} recorded connections</p><p>Rebuilt from saved case data every time you search. Last read ${esc(new Date(c.builtAt).toLocaleTimeString('en-AU', {hour:'2-digit',minute:'2-digit'}))}.</p><div class="coverage-grid">${Object.entries(data.types).map(([key,label]) => `<div><strong>${c.counts[key] || 0}</strong><span>${esc(label)}</span></div>`).join('')}</div><h3>How things connect</h3><p>Imported text leads back to its file number and page. Notes connect people, events and evidence through recorded references. Tasks and timeline events supply Calendar; they appear once in search at their original source. Saved journal, notebook, task and calendar revisions can be included with “Earlier versions”.</p><h3>${c.gaps.length ? `${c.gaps.length} items need attention` : 'No read failures detected'}</h3>${c.gaps.length ? `<ul>${c.gaps.map(g => `<li><strong>${esc(g.title)}</strong> — ${esc(g.reason)}</li>`).join('')}</ul>` : '<p>Coverage depends on the text available in your saved records.</p>'}<p>${c.unresolvedLinks} map links could not be resolved to a saved note.</p><h3>Outside this index</h3><ul>${c.exclusions.map(x => `<li>${esc(x)}</li>`).join('')}</ul><h3>AI deep search</h3><p>Collects up to 12 relevant excerpts using keywords and recorded links. You review the exact text before sending it to your connected ChatGPT account. Notebook and journal text are excluded unless you choose to include them. AI answers need checking against their sources.</p>` : '<p>Reading the saved case index…</p>'}</div>`;
    } else if(pane === 'deep') {
      target.innerHTML = `<div class="index-subheading"><h2>${icon('ai')}AI deep search</h2><button class="btn" type="button" data-back ${sending ? 'disabled' : ''}>Back to results</button></div><div class="index-scroll deep-content"><p class="deep-question">${esc(query)}</p><p>Search all current record types and their recorded connections. Review excerpts before they leave this computer.</p><div class="deep-controls"><label><input type="checkbox" id="deep-personal" ${personal ? 'checked' : ''} ${sending ? 'disabled' : ''}>Include relevant notebook & journal text</label><button type="button" class="btn" id="prepare-deep" ${sending ? 'disabled' : ''}>${icon('search')}${review ? 'Refresh excerpts' : 'Prepare excerpts'}</button></div><div id="deep-review">${review ? `<div class="deep-preview-heading"><h3>${review.sources.length} selected excerpts</h3><span>${review.matches} keyword matches · ${review.gapCount} index gaps</span></div><div class="deep-source-list">${review.sources.map(s => `<button type="button" class="deep-source" data-result-key="${esc(s.key)}"><b>[${s.citation}]</b><span>${esc(s.title)}<small>${esc(s.locator)} · ${esc(s.reason)}</small></span></button>`).join('')}</div><label class="deep-payload-label" for="deep-payload">Exact text to send to ChatGPT</label><textarea id="deep-payload" readonly spellcheck="false">${esc(review.text)}</textarea><p class="deep-scope">Current versions only. Up to 2,200 characters per excerpt. This selection does not cover the whole case.</p>` : answer ? '' : '<div class="index-empty">Prepare a local preview to see which sources AI can examine.</div>'}</div>${answer ? `<section class="deep-answer"><h3>AI findings</h3><p class="deep-scope">${esc(answer.model || 'ChatGPT')} · Check each statement against its linked source.</p><div class="deep-answer-text">${citationText(answer.text, answer.sources)}</div><div class="deep-source-list">${answer.sources.map(s => `<button type="button" class="deep-source" data-result-key="${esc(s.key)}"><b>[${s.citation}]</b><span>${esc(s.title)}<small>${esc(s.locator)}</small></span></button>`).join('')}</div></section>` : ''}</div><div class="index-footer deep-footer"><span id="deep-state" role="status">${sending ? 'Reading the reviewed excerpts…' : 'Uses your ChatGPT account and its available allowance.'}</span><button type="button" class="btn" id="deep-connect">${icon('ai')}Connect ChatGPT</button><button type="button" class="btn primary" id="send-deep" ${!review || sending || !desktop?.deepSearch ? 'disabled' : ''}>Send reviewed text ${icon('send')}</button><button type="button" class="btn" id="cancel-deep" ${sending ? '' : 'hidden'}>Cancel</button></div>`;
      find('deep-personal').addEventListener('change', e => { personal = e.target.checked; review = null; answer = null; render(); });
      find('prepare-deep').addEventListener('click', prepare);
      find('send-deep').addEventListener('click', send);
      find('deep-connect').addEventListener('click', () => window.dispatchEvent(new CustomEvent('caseforge:open-panel', { detail: { name: 'ai' } })));
      find('cancel-deep').addEventListener('click', async () => { await desktop?.chatGPTCancel?.(); });
    } else if(pane === 'record') {
      return;
    } else {
      target.innerHTML = `<div class="index-filters"><label>Show<select id="index-type"><option value="">All records</option>${Object.entries(data?.types || {}).map(([k,v]) => `<option value="${esc(k)}" ${type === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label><label>Match<select id="index-mode"><option value="all" ${mode === 'all' ? 'selected' : ''}>All words</option><option value="any" ${mode === 'any' ? 'selected' : ''}>Any word</option></select></label><label class="index-history"><input id="index-history" type="checkbox" ${history ? 'checked' : ''}>Earlier versions</label><span class="index-result-count" role="status">${query && data ? `${data.total} results` : 'On this computer'}</span></div><div class="index-scroll" id="index-results" aria-label="Search results">${query && data?.results?.length ? data.results.map(resultRow).join('') : `<div class="index-empty">${icon('search')}<h3>${query ? 'No matching saved text.' : 'Your case, one search.'}</h3><p>${query ? 'Try fewer words, choose Any word, or search a file number.' : 'Type in the search bar and press Enter. Use quotes for an exact phrase.'}</p><p>Files · People · Timeline · Calendar · Notes</p></div>`}</div><div class="index-footer"><span>${data ? `${data.coverage.current} current records indexed${data.coverage.gaps.length ? ` · ${data.coverage.gaps.length} index gaps` : ''}` : 'Reading saved records…'}</span><div class="index-pagination"><button class="btn" type="button" id="index-prev" ${!data || data.offset === 0 ? 'disabled' : ''}>Previous</button><span>${query && data?.total ? `${data.offset + 1}–${Math.min(data.total, data.offset + data.limit)} of ${data.total}` : '0 results'}</span><button class="btn" type="button" id="index-next" ${!data || data.offset + data.limit >= data.total ? 'disabled' : ''}>Next</button></div></div>`;
      for(const id of ['index-type','index-mode','index-history']) find(id).addEventListener('change', () => { type = find('index-type').value; mode = find('index-mode').value; history = find('index-history').checked; offset = 0; void load(); });
      find('index-prev').addEventListener('click', () => { offset = Math.max(0, data.offset - data.limit); void load(); });
      find('index-next').addEventListener('click', () => { offset = data.offset + data.limit; void load(); });
    }
    bindPane(target);
  }
  function citationText(text, sources) {
    return esc(text).replace(/\[S(\d+)\]/g, (label, n) => {
      const source = sources.find(s => s.citation === `S${n}`);
      return source ? `<button type="button" class="citation-link" data-result-key="${esc(source.key)}">${label}</button>` : label;
    });
  }
  function bindPane(target) {
    target.querySelectorAll('[data-back]').forEach(b => b.addEventListener('click', () => { pane = 'results'; notice(''); render(); }));
    target.querySelectorAll('[data-result-key]').forEach(b => b.addEventListener('click', () => void preview(b.dataset.resultKey)));
  }
  async function preview(key) {
    if(sending) return;
    const previous = pane, turn = ++serial; notice('Opening saved text…');
    try {
      const record = await api(`/api/search/record?key=${encodeURIComponent(key)}`);
      if(!host || turn !== serial) return;
      pane = 'record'; host.dataset.searchPane = pane; notice('');
      const target = find('search-pane');
      target.innerHTML = `<div class="index-subheading"><div><h2>${esc(record.title)}</h2><span>${esc(record.reference)}${record.history ? ' · Earlier saved version' : ''}</span></div><button type="button" class="btn" id="preview-back">Back</button><button type="button" class="btn" id="preview-source">Open current source ${icon('arrowRight')}</button></div><div class="index-scroll index-record">${record.parts.map(p => `<h3>${esc(p.label)}</h3><pre>${esc(p.text)}</pre>`).join('')}${record.clipped ? '<p>Preview limited to 200,000 characters. Open the original source for the full record.</p>' : ''}</div>`;
      find('preview-back').addEventListener('click', () => { pane = previous === 'record' ? 'results' : previous; render(); });
      find('preview-source').addEventListener('click', () => openRecord(record.kind, record.id));
    } catch(error) { if(turn === serial) notice(error.message, true); }
  }
  async function load() {
    const turn = ++serial; notice('Searching saved case text…');
    try {
      const result = await api(`/api/search?${new URLSearchParams({q:query, type, history:String(history), mode, offset:String(offset)})}`);
      if(!host || turn !== serial) return;
      data = result; offset = result.offset; notice(''); render();
    } catch(error) { if(host && turn === serial) notice(error.message, true); }
  }
  async function submit(value) {
    query = value.trim(); input.value = query; offset = 0; data = null; review = null; answer = null; pane = 'results';
    if(document.body.dataset.workspaceView !== 'search') await go('search');
    else { shell(); await load(); }
  }
  async function prepare() {
    const turn = ++serial; notice('Collecting matching excerpts on this computer…'); find('prepare-deep').disabled = true;
    try {
      const next = await api('/api/search/prepare', {method:'POST', body:{query, includePersonal:personal}});
      if(!host || turn !== serial) return;
      review = next; answer = null; notice('Review the exact text below. Nothing has been sent to AI.'); render();
    } catch(error) { if(host && turn === serial) { notice(error.message, true); render(); } }
  }
  async function send() {
    if(!review || sending) return;
    const turn = ++serial; sending = true; notice(''); render();
    try {
      const response = await desktop.deepSearch({caseKey:getSession().caseKey, reviewId:review.id, consent:true});
      if(response?.error) throw new Error(response.error);
      if(host && turn === serial) { answer = response; review = null; notice('AI findings are ready. Check the citations against the saved text.'); }
    } catch(error) { if(host && turn === serial) { review = null; notice(`${error.message} Prepare fresh excerpts to try again.`, true); } }
    finally { sending = false; if(host && turn === serial) render(); }
  }
  input.addEventListener('keydown', e => { if(e.key === 'Enter') { e.preventDefault(); void submit(input.value); } });
  document.addEventListener('keydown', e => { if((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); input.focus(); input.select(); } });
  return { close, unmount, async mount(element) { host = element; if(pane === 'record') pane = 'results'; shell(); await load(); } };
}
