import { SCAN_QUESTIONS } from './scan-questions.js';
import { icon } from './icons.js';
import { fileRegister, esc } from './file-register.js';
import { getChatGPTConnection, chatGPTBrand } from './chatgpt-connection.js';

const chevron = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
const REGIONS = ['Commonwealth', 'ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA'];
const SECTIONS = [
  ['provenance', '2. Identity and provenance', ['identity', 'provenance', 'metadata']],
  ['facts', '3. Facts and attributed claims', ['fact', 'facts', 'claim', 'attributed_claim', 'event']],
  ['evidence', '4. Supporting evidence', ['evidence', 'supporting_evidence']],
  ['discrepancies', '6. Discrepancies', ['discrepancy', 'discrepancies']],
  ['inconsistencies', '7. Inconsistencies', ['inconsistency', 'inconsistencies']],
  ['contradictions', '8. Contradictions', ['contradiction', 'contradictions']],
  ['misleading', '9. Potentially misleading statements', ['misleading', 'potentially_misleading', 'unsupported']],
  ['patterns', '10. Patterns within this document', ['pattern', 'patterns']],
  ['risk', '11. Risk and impact', ['risk', 'impact', 'risk_impact']],
  ['followup', '12. Opportunities and follow-up', ['opportunity', 'opportunities', 'follow_up', 'followup']],
];
const dateTime = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' }) : 'Date unavailable';
const duration = value => { const seconds = Math.floor(Math.max(0, Number(value) || 0) / 1000); return `${Math.floor(seconds / 60)}m ${seconds % 60}s`; };
const words = value => String(value || '').replace(/[_-]+/g, ' ');
const endpoint = id => `/api/documents/${encodeURIComponent(id)}`;
const anchorLabel = (anchor, page) => anchor?.label || (anchor?.kind === 'cell' ? `${anchor.sheet ? `${anchor.sheet} · ` : ''}${anchor.cell || `Row ${anchor.row}, column ${anchor.column}`}` : anchor?.kind === 'paragraph' ? `Paragraph ${anchor.paragraph}` : anchor?.kind === 'timestamp' ? `Recording · ${duration(anchor.startMs ?? anchor.timestampMs ?? 0)}` : `Page ${page}`);

export function scanLabel(scan) {
  if (!scan) return 'Not scanned';
  if (scan.state === 'queued') return `Scan scheduled — position ${scan.queuePosition || 1} in queue`;
  if (scan.state === 'running') return `Scan in progress — ${duration(scan.elapsedMs)} · ${words(scan.stage || 'preparing')}`;
  if (scan.state === 'completed') return `Scan completed — ${dateTime(scan.completedAt)}`;
  return ({ paused: 'Scan paused', cancelled: 'Scan cancelled', interrupted: 'Scan interrupted — ready to resume', sign_in_required: 'Sign in with ChatGPT to continue', setup_required: 'File reader setup required', attention: 'Scan needs attention', failed: 'Scan failed — retry available' })[scan.state] || 'Scan needs attention';
}
function details(key, title, body, count = '') {
  return `<details class="scan-section" data-section="${esc(key)}"><summary><span class="scan-disclosure">${chevron}</span><span class="scan-section-title">${esc(title)}</span>${count !== '' ? `<span>${count}</span>` : ''}</summary><div class="scan-section-body">${body}</div></details>`;
}
function valueMarkup(value) {
  if (value === null || value === undefined || value === '') return '<p class="scan-muted">Not recorded.</p>';
  if (Array.isArray(value)) return value.length ? `<ul>${value.map(item => `<li>${valueMarkup(item)}</li>`).join('')}</ul>` : '<p class="scan-muted">None recorded.</p>';
  if (typeof value === 'object') return `<dl class="scan-fields">${Object.entries(value).filter(([, item]) => item !== null && item !== undefined).map(([key, item]) => `<dt>${esc(words(key))}</dt><dd>${valueMarkup(item)}</dd>`).join('')}</dl>`;
  return `<p>${esc(value)}</p>`;
}
function lawUrl(value) { try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; } catch { return null; } }
function sourceMarkup(source, id, reportId = '') {
  const sourceDocument = source.documentId || id;
  // Legacy reports may reference a comparison document. Keep its original
  // document identity without requesting another document's report identifier.
  if (sourceDocument !== id) reportId = '';
  id = sourceDocument;
  const location = source.locator || anchorLabel(source.anchor, Number(source.page) || 1);
  const attribution = [['Speaker', source.speaker], ['Recipient', source.recipient], ['Reporting source', source.reportingSource], ['Sequence', source.sequence]].filter(([, value]) => value !== undefined && value !== null && value !== '');
  if (source.sourceMatch === 'visual_observation') return `<div class="scan-source"><p><strong>Visual observation</strong></p><p class="scan-muted">Check this finding against the original image or sampled video frame.</p><button type="button" class="text-button" data-source-document="${esc(id)}" data-source-page="${Number(source.page) || 1}" data-report-id="${esc(reportId)}" data-source-match="visual_observation">${esc(location)} · View source image</button></div>`;
  return `<div class="scan-source"><blockquote>${esc(source.quote || 'No quotation recorded.')}</blockquote><p class="scan-attribution">${attribution.map(([key, value]) => `${key}: ${esc(value)}`).join(' · ') || 'Attribution not identified.'}</p><button type="button" class="text-button" data-source-document="${esc(id)}" data-source-page="${Number(source.page) || 1}" data-report-id="${esc(reportId)}" data-source-match="${esc(source.sourceMatch || '')}">${esc(location)} · Read source</button>${source.sourceMatch === false || source.matched === false ? '<span class="scan-warning">Quotation could not be matched to extracted text.</span>' : ''}</div>`;
}
function findingMarkup(finding, id, reportId = '') {
  return `<article class="scan-finding"><h4>${esc(finding.title || words(finding.kind))}</h4><p>${esc(finding.detail || finding.statement || '')}</p>${finding.strength ? `<p><strong>Evidence strength:</strong> ${esc(finding.strength)}</p>` : ''}${finding.limitations?.length ? `<div class="scan-muted">${valueMarkup(finding.limitations)}</div>` : ''}${(finding.sources || []).map(source => sourceMarkup(source, id, reportId)).join('')}</article>`;
}

const answerLabels = {answered:'Answered',no_findings:'No finding identified',needs_review:'Needs review',not_applicable:'Not applicable',not_assessed:'Not assessed'};
export function scanPlan() {
  return `<details class="scan-plan" open><summary><span class="scan-disclosure">${chevron}</span><strong>What the AI checks</strong><span>13 questions · one answer per question</span></summary><div class="scan-plan-grid">${SCAN_QUESTIONS.map(q=>`<button type="button" class="scan-plan-item" data-question-target="${q.id}" data-group="${q.group}"><span>${q.number}</span><span>${esc(q.title)}</span></button>`).join('')}</div><p class="scan-muted">Each answer includes evidence, limitations and follow-up. These checks apply to one document.</p></details>`;
}
function questionAnswer(report, q) {
  const answer = report.questionAnswers?.find(a=>a.id===q.id);
  return `<div class="scan-question-answer" data-question-id="${q.id}"><p class="scan-question">${esc(q.question)}</p><span class="scan-answer-status">${answer ? esc(answerLabels[answer.status] || 'Not assessed') : 'Answer not recorded'}</span><dl class="scan-answer-fields"><dt>Answer</dt><dd>${esc(answer?.answer || 'This report has no question-by-question answer. Scan again to answer this question.')}</dd><dt>Limitations</dt><dd>${esc(answer?.limitations || (answer ? 'None stated in this answer.' : 'This check has not been explicitly answered.'))}</dd><dt>Follow-up</dt><dd>${esc(answer?.followUp || (answer ? 'None recorded.' : 'Scan again to generate a mapped answer.'))}</dd></dl></div>`;
}

export function reportMarkup(report, id) {
  const questionDetails = (key, title, body, count = '') => {
    const q=SCAN_QUESTIONS.find(q=>q.id===key), answer=report.questionAnswers?.find(a=>a.id===key);
    if(answer && !['context','output'].includes(key)) body=(report.findings || []).filter(f=>answer.findingIds?.includes(f.id)).map(f=>findingMarkup(f,id,report.id)).join('')+(answer.lawIndexes || []).map(i=>report.laws?.[i]).filter(Boolean).map(l=>`<article class="scan-law"><h4>${esc(l.title)}${l.provision ? ` · ${esc(l.provision)}` : ''}</h4><blockquote>${esc(l.text || 'Provision text unavailable.')}</blockquote><p>${esc(l.relevance)}</p><p class="scan-muted">${esc(l.version || 'Applicable version not confirmed')} · ${esc(words(l.versionStatus || 'needs verification'))}</p>${l.assumptions ? valueMarkup(l.assumptions) : ''}${lawUrl(l.url) ? `<a href="${esc(lawUrl(l.url))}" target="_blank" rel="noopener noreferrer">Official source</a>` : ''}</article>`).join('') || '<p class="scan-muted">No supporting finding or legal reference linked to this answer.</p>';
    return details(key, `${q.number}. ${q.title}`, questionAnswer(report,q)+`<div class="scan-answer-evidence"><h4>Evidence and detail</h4>${body}</div>`, answer ? answerLabels[answer.status] : 'Answer not recorded').replace('class="scan-section"',`class="scan-section" data-group="${q.group}"`);
  };
  const findings = report.findings || [];
  const law = (report.laws || []).map(item => `<article class="scan-law"><h4>${esc(item.title)}${item.provision ? ` · ${esc(item.provision)}` : ''}</h4><blockquote>${esc(item.text || 'Provision text unavailable.')}</blockquote><p>${esc(item.relevance || '')}</p><p class="scan-muted">${esc(item.version || 'Applicable version not confirmed')} · ${esc(words(item.versionStatus || 'needs verification'))}</p>${item.assumptions ? valueMarkup(item.assumptions) : ''}${lawUrl(item.url) ? `<a class="record-link" href="${esc(lawUrl(item.url))}" target="_blank" rel="noopener noreferrer">Official source ↗</a>` : '<p class="scan-warning">Official source link unavailable.</p>'}</article>`).join('') || '<p class="scan-muted">No verified legal match recorded.</p>';
  const rows = SECTIONS.map(([key, title, kinds]) => {
    const entries = findings.filter(finding => kinds.includes(finding.kind));
    return questionDetails(key, title, entries.map(finding => findingMarkup(finding, id, report.id)).join('') || '<p class="scan-muted">No findings recorded for this check.</p>', entries.length);
  });
  rows.splice(3, 0, questionDetails('laws', '5. Relevant law', law + (report.legalLimitations?.length ? valueMarkup(report.legalLimitations) : ''), (report.laws || []).length));
  const unknown = findings.filter(finding => !SECTIONS.some(([, , kinds]) => kinds.includes(finding.kind)));
  return `<section class="scan-report">${report.legacy ? '<p class="scan-warning">Legacy analysis — retained from the previous workflow. This is not a new completed scan.</p>' : ''}${scanPlan()}<h3>Document summary</h3><p class="scan-summary-text">${esc(report.summary || 'No summary was recorded.')}</p>${report.attention?.length ? `<details class="scan-review-notes"><summary>${chevron} Review notes · ${report.attention.length}</summary>${valueMarkup([...new Set(report.attention)])}</details>` : ''}<p class="scan-muted">Findings describe this document only. A source match confirms a quotation exists, not that an allegation is true.</p>${questionDetails('context', '1. Context and jurisdiction', valueMarkup(report.context) + '<h4>Jurisdiction</h4>' + valueMarkup(report.jurisdiction))}${rows.join('')}${questionDetails('output', '13. Saved output and coverage', `${unknown.map(finding => findingMarkup(finding, id)).join('')}<h4>Coverage</h4>${valueMarkup(report.coverage)}<h4>Model and usage</h4><p>${esc(report.model || (report.legacy ? 'Legacy provider' : 'GPT-6 Astra'))}${report.effort ? ` · ${esc(report.effort)}` : ''}</p>${valueMarkup(report.usage)}<p>Saved within Files &amp; AI. No records are automatically added to other case tools.</p>`)}</section>`;
}

export function createInbox({ api, getSession, updateSession, showModal, onOpenScan, desktop = () => globalThis.window?.strategistDesktop }) {
  let host = null, mode = null, timer = null, generation = 0, refreshing = false, documents = [], openId = null;
  let settings = { country: 'AU', regions: ['Commonwealth'], confirmed: false }, settingsDirty = false, registerMarkup = '', account = null, readersInstalling = false;
  let unsubscribeAccount = null, closeConnectionModal = null;
  const pending = new Set(), loaded = new Map(), objectUrls = new Set();
  const find = selector => host?.querySelector(selector);
  const writable = () => getSession()?.access?.canWrite === true;
  function notice(message, error = false) { const node = find('#inbox-message'); if (node) { node.textContent = message; node.classList.toggle('error', error); } }
  function unmount() {
    unsubscribeAccount?.(); unsubscribeAccount = null; closeConnectionModal?.(); closeConnectionModal = null;
    generation++; clearInterval(timer); timer = null;
    host?.removeEventListener('click', handleClick); host?.removeEventListener('toggle', handleToggle, true);
    host = null; mode = null; refreshing = false; registerMarkup = ''; loaded.clear(); openId = null;
    clearObjectUrls();
  }
  function begin(element, nextMode) {
    unmount(); host = element; mode = nextMode;
    host.addEventListener('click', handleClick); host.addEventListener('toggle', handleToggle, true);
    timer = setInterval(() => { if (!document.hidden) void refresh(); }, 2000);
  }
  function mountDesk(element) {
    begin(element, 'desk');
    host.innerHTML = `<div class="page-purpose"><p>Your case files, all in one place.</p><span>Add files here, then select Scan. Selected text and images are sent to your signed-in ChatGPT account.</span></div><section class="case-desk intake-shortcut" aria-labelledby="desk-heading"><div class="desk-toolbar"><h2 id="desk-heading">Your file register</h2><div class="file-actions"><button class="btn" type="button" data-file-action="backup">${icon('download')}Back up case</button><label class="btn primary desk-upload" id="document-drop" tabindex="0" role="button" aria-label="Add files to this case">${icon('plus')}Add files<input id="document-picker" type="file" multiple hidden></label></div></div><div id="desk-files"><p class="empty">Loading your files…</p></div><div class="desk-bottom"><span id="document-count">0 files</span><small>Up to 512 MB per file · imports stay local</small></div></section><p id="inbox-message" class="inbox-message" role="status" aria-live="polite"></p>`;
    const picker = find('#document-picker'), drop = find('#document-drop');
    if (desktop()?.restoreCaseBackup) {
      const restore = document.createElement('button'); restore.className = 'btn'; restore.type = 'button'; restore.dataset.fileAction = 'restore'; restore.textContent = 'Restore backup';
      find('.file-actions').insertBefore(restore, drop);
    }
    picker.addEventListener('change', event => { void upload(event.target.files); event.target.value = ''; });
    drop.addEventListener('keydown', event => { if (['Enter', ' '].includes(event.key) && event.target === drop) { event.preventDefault(); if (!picker.disabled) picker.click(); } });
    drop.addEventListener('dragover', event => { event.preventDefault(); drop.classList.add('dragging'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('dragging'));
    drop.addEventListener('drop', event => { event.preventDefault(); drop.classList.remove('dragging'); void upload(event.dataTransfer.files); });
    void refresh();
  }
  function mount(element) {
    begin(element, 'scans'); settingsDirty = false; settings = { country: 'AU', regions: ['Commonwealth'], confirmed: false };
    host.innerHTML = `<div class="page-purpose files-ai-intro"><div><p>Follow each document, from context to findings.</p><span>Start scans in Case desk. Each report stays here for review.</span></div><button class="btn" type="button" data-file-action="connect">${icon('ai')}<span id="scan-account">Sign in with ChatGPT</span></button></div><section class="files-ai-workbench" aria-label="Document scans"><div class="scan-card-list" id="scan-card-list" aria-label="Scan results"><p class="empty">Loading scans…</p></div></section><p id="inbox-message" class="inbox-message" role="status" aria-live="polite"></p>`;
    const connection = getChatGPTConnection(desktop());
    unsubscribeAccount = connection.subscribe(result => {
      account = result;
      const label = find('#scan-account');
      if (label) label.textContent = result.connected ? 'ChatGPT connected' : result.signingIn ? 'Finish signing in' : 'Sign in with ChatGPT';
      const status = find('#scan-connection-status');
      if (status) status.textContent = result.error || 'GPT-6 Astra · Low reasoning · Your ChatGPT limits apply';
    });
    void connection.refresh();
    void loadSettings(); void refresh();
  }
  async function loadSettings() {
    const revision = generation;
    const responses = await Promise.allSettled([api('/api/scan-settings'), api('/api/readers')]);
    if (!host || generation !== revision || mode !== 'scans') return;
    if (responses[0].status === 'fulfilled') { settings = responses[0].value.jurisdiction || responses[0].value; paintSettings(); }
    if (responses[1].status === 'fulfilled') paintReaders(responses[1].value);
  }
  function paintSettings() {
    if (!settingsDirty) find('#scan-regions')?.querySelectorAll('input').forEach(input => { input.checked = settings.regions?.includes(input.value) === true; });
    const label = find('#scan-jurisdiction-label'); if (label) label.textContent = `Australia · ${(settings.regions || []).join(', ') || 'needs selection'}`;
  }
  function paintReaders(status) {
    const node = find('#scan-readers-status'); if (!node) return;
    const setup = status.setup || status;
    readersInstalling = setup.state === 'installing';
    const button = find('[data-file-action="readers"]'); if (button) button.disabled = readersInstalling || !writable();
    if (readersInstalling || setup.state === 'failed') { const progress = setup.progress; node.textContent = setup.message || `Setting up file readers${progress?.dependency ? ` · ${progress.dependency}` : ''}${progress?.bytes ? ` · ${(progress.bytes / 1024 / 1024).toFixed(1)} MB` : ''}…`; return; }
    const readers = status.readers || status.components;
    node.textContent = (status.message || (Array.isArray(readers) ? readers.map(item => `${item.name || item.id}: ${item.ready || item.available ? 'ready' : item.state || 'setup needed'}`).join(' · ') : status.ready ? 'File readers ready.' : 'File readers are checked when a document needs them.')) + (!status.ready && status.downloadBytes ? ` Download: approximately ${Math.round(status.downloadBytes / 1_000_000)} MB.` : '');
  }
  function chosenJurisdiction() { return { country: 'AU', regions: [...(find('#scan-regions')?.querySelectorAll('input:checked') || [])].map(input => input.value), confirmed: true }; }
  async function upload(files) {
    if (!writable()) return notice('This workspace is read-only.', true);
    const revision = generation;
    for (const file of Array.from(files || [])) {
      if (revision !== generation || mode !== 'desk') return;
      if (!file.size || file.size > 512 * 1024 * 1024) { notice(`${file.name}: choose a non-empty file up to 512 MB.`, true); continue; }
      notice(`Adding ${file.name} to your local case…`);
      try {
        const result = await api(`/api/documents?name=${encodeURIComponent(file.name)}`, { method: 'POST', raw: true, body: file });
        if (revision !== generation) return;
        notice(result.duplicate ? `${file.name} is already registered.` : `${file.name} added. Select Scan when ready.`);
        await refresh();
      } catch (error) { if (revision === generation) notice(`${file.name}: ${error.message}`, true); }
    }
  }
  async function refresh(force = false) {
    if (!host || refreshing) return;
    refreshing = true; const revision = generation;
    try {
      const result = await api('/api/documents');
      if (!host || revision !== generation) return;
      documents = result.documents || [];
      if (result.access) updateSession({ ...getSession(), access: result.access });
      if (mode === 'desk') renderDesk(); else await renderCards(force, revision);
      if (mode === 'scans' && readersInstalling) { const readers = await api('/api/readers'); if (revision !== generation) return; paintReaders(readers); }
    } catch (error) { if (revision === generation) notice(error.message, true); }
    finally { if (revision === generation) refreshing = false; }
  }
  function renderDesk() {
    const list = find('#desk-files'), rows = list.querySelector('.register-rows');
    const markup = documents.length ? fileRegister(documents, { writable: writable(), pending }) : '<div class="desk-empty"><h3>Start with a file.</h3><p>Add documents, images or recordings. Each file gets a permanent number.</p></div>';
    if (registerMarkup !== markup) {
      const scrollTop = rows?.scrollTop || 0, focus = list.contains(document.activeElement) ? document.activeElement : null;
      const focused = focus?.dataset.scanDocument, focusedRecord = focus?.dataset.recordId;
      const rowsFocused = rows === document.activeElement;
      list.innerHTML = markup; registerMarkup = markup;
      const nextRows = list.querySelector('.register-rows'); if (nextRows) { nextRows.scrollTop = scrollTop; if (rowsFocused) nextRows.focus({ preventScroll: true }); }
      if (focused) [...list.querySelectorAll('[data-scan-document]')].find(button => button.dataset.scanDocument === focused)?.focus({ preventScroll: true });
      else if (focusedRecord) [...list.querySelectorAll('[data-record-id]')].find(link => link.dataset.recordId === focusedRecord)?.focus({ preventScroll: true });
    }
    find('#document-count').textContent = `${documents.length} files · permanent references`;
    find('#document-picker').disabled = !writable();
    find('#document-drop').setAttribute('aria-disabled', String(!writable()));
    find('[data-file-action="backup"]').disabled = !writable();
  }
  function actions(d) {
    const state = d.scan?.state, disabled = !writable() || pending.has(d.id);
    const button = (action, label) => `<button class="btn small" type="button" data-scan-action="${action}" data-id="${esc(d.id)}" ${disabled ? 'disabled' : ''}>${label}</button>`;
    const controls = state === 'queued' ? button('next', 'Scan next') + button('pause', 'Pause') + button('cancel', 'Cancel')
      : state === 'running' ? button('pause', 'Pause') + button('cancel', 'Cancel')
      : state === 'completed' ? button('scan', 'Scan again')
      : state === 'attention' ? button('resume', 'Resume with saved jurisdiction') + button('retry', 'Retry scan') + button('cancel', 'Cancel')
      : ['paused', 'interrupted', 'sign_in_required', 'setup_required'].includes(state) ? button('resume', 'Resume') + button('cancel', 'Cancel')
      : ['failed', 'cancelled'].includes(state) ? button('retry', 'Retry scan') : '';
    return `<div class="scan-actions">${controls}<button class="text-button" type="button" data-open-document="${esc(d.id)}">Open document</button></div>`;
  }
  async function renderCards(force, revision) {
    const list = find('#scan-card-list'), visible = documents.filter(d => d.scan || d.latestReportId || d.draft || d.legacyReport);
    if (!visible.length) { list.innerHTML = '<div class="scan-empty"><h3>Your document scans will appear here.</h3><p>In Case desk, select Scan beside a file to begin.</p><button class="btn" data-go="dashboard" type="button">Open Case desk</button></div>'; return; }
    list.querySelector('.scan-empty,.empty')?.remove();
    const valid = new Set(visible.map(d => d.id));
    list.querySelectorAll('.scan-card').forEach(card => { if (!valid.has(card.dataset.documentId)) card.remove(); });
    for (const d of visible) {
      let card = [...list.children].find(node => node.dataset.documentId === d.id);
      if (!card) {
        card = document.createElement('details'); card.className = 'scan-card'; card.dataset.documentId = d.id;
        card.innerHTML = `<summary class="scan-card-heading"><span class="scan-card-icon">${icon('file')}</span><span class="scan-card-name"><span class="file-reference"></span><strong></strong><span class="scan-card-status"></span></span><span class="scan-card-type"></span><span class="scan-card-chevron">${chevron}</span></summary><div class="scan-card-body"><div class="scan-card-controls"></div><details class="scan-card-error-box" hidden><summary>Scan needs attention</summary><p class="scan-card-error scan-warning" role="status" hidden></p></details><div class="scan-card-report"><p class="scan-muted">Expand this card to read its saved findings.</p></div></div>`;
        list.append(card);
      }
      card.querySelector('.file-reference').textContent = d.reference || '';
      card.querySelector('.scan-card-name strong').textContent = d.name;
      card.querySelector('.scan-card-status').textContent = d.scan ? scanLabel(d.scan) : 'Legacy report — not rescanned';
      card.querySelector('.scan-card-type').textContent = (d.extension || '').replace('.', '').toUpperCase();
      card.dataset.state = d.scan?.state || 'legacy';
      const controls = card.querySelector('.scan-card-controls'), next = actions(d);
      if (controls.scanMarkup !== next) {
        const focus = controls.contains(document.activeElement) ? document.activeElement : null;
        const action = focus?.dataset.scanAction, original = focus?.dataset.openDocument;
        controls.innerHTML = next; controls.scanMarkup = next;
        if (focus) {
          const replacement = [...controls.querySelectorAll('button')].find(button => !button.disabled && (action ? button.dataset.scanAction === action : original && button.dataset.openDocument === original));
          (replacement || card.querySelector('.scan-card-heading')).focus({ preventScroll: true });
        }
      }
      const error = card.querySelector('.scan-card-error'); error.textContent = d.scan?.error?.message || d.scan?.error || ''; error.hidden = !error.textContent; error.closest('.scan-card-error-box').hidden = !error.textContent;
      if (openId === d.id) card.open = true;
      const signature = JSON.stringify([d.latestReportId, d.scan?.state, d.updatedAt]);
      if (card.open && (force || loaded.get(d.id)?.signature !== signature)) await loadReport(d.id, signature, revision);
      if (!host || revision !== generation) return;
      if (!loaded.get(d.id)?.loading && loaded.get(d.id)?.signature === signature) revealRequestedCard(card, revision);
    }
  }
  function revealRequestedCard(card, revision) {
    if (revision !== generation || mode !== 'scans' || openId !== card.dataset.documentId) return;
    openId = null;
    const list = find('#scan-card-list');
    // Explicit navigation moves only the internal list. Polling never calls this
    // without a pending destination, so reading position and focus stay put.
    list.scrollTop = Math.max(0, list.scrollTop + card.getBoundingClientRect().top - list.getBoundingClientRect().top - list.clientTop);
    card.querySelector('.scan-card-heading').focus({ preventScroll: true });
  }
  async function loadReport(id, signature, revision = generation) {
    const loading = loaded.get(id); if (loading?.loading) return;
    loaded.set(id, { ...loading, loading: true });
    try {
      const detail = await api(endpoint(id));
      if (!host || generation !== revision || mode !== 'scans') return;
      const card = [...find('#scan-card-list').children].find(node => node.dataset.documentId === id); if (!card) return;
      const container = card.querySelector('.scan-card-report');
      const planOpen = container.querySelector('.scan-plan')?.open;
      const openSections = [...container.querySelectorAll('details[open]')].map(node => node.dataset.section);
      const active = container.contains(document.activeElement) ? document.activeElement.closest('[data-section]')?.dataset.section : null;
      const report = detail.reports?.[0] || (detail.draft ? { ...detail.draft, legacy: true } : null);
      const content = report ? reportMarkup(report, id) + (detail.reports?.length > 1 ? details('history', `Earlier reports (${detail.reports.length - 1})`, detail.reports.slice(1).map((previous, index) => details(`version-${index}`, `Report ${previous.version || index + 1} · ${dateTime(previous.completedAt || previous.createdAt)}`, reportMarkup(previous, id))).join('')) : '') : scanPlan() + '<p class="scan-muted">The report will appear here when analysis has been saved. Your original stays available throughout the scan.</p>';
      if (container.scanMarkup !== content) {
        const scroll = find('#scan-card-list').scrollTop;
        container.innerHTML = content; container.scanMarkup = content;
        if (planOpen !== undefined && container.querySelector('.scan-plan')) container.querySelector('.scan-plan').open=planOpen;
        container.querySelectorAll('[data-section]').forEach(node => { if (openSections.includes(node.dataset.section)) node.open = true; });
        if (active) [...container.querySelectorAll('[data-section]')].find(node => node.dataset.section === active)?.querySelector('summary')?.focus({ preventScroll: true });
        find('#scan-card-list').scrollTop = scroll;
      }
      loaded.set(id, { signature, loading: false });
      revealRequestedCard(card, revision);
    } catch (error) { loaded.delete(id); if (revision === generation) notice(error.message, true); }
  }
  function handleToggle(event) {
    const card = event.target;
    if (card.classList?.contains('scan-card') && card.open) {
      const d = documents.find(item => item.id === card.dataset.documentId);
      if (d) void loadReport(d.id, JSON.stringify([d.latestReportId, d.scan?.state, d.updatedAt]));
    }
  }
  async function command(id, action, rescan = false) {
    if (!writable() || pending.has(id)) return;
    pending.add(id); const revision = generation;
    if (mode === 'desk') renderDesk();
    try {
      const body = action === 'scan' ? { rescan } : action === 'resume' && settings.confirmed ? { jurisdiction: settings } : {};
      await api(`${endpoint(id)}/${action}`, { method: 'POST', body });
      if (revision === generation) notice(action === 'scan' ? 'Scan queued. Follow its progress in Files & AI.' : 'Scan updated.');
    } catch (error) { if (revision === generation) notice(error.message, true); }
    finally { pending.delete(id); if (revision === generation) await refresh(true); }
  }
  async function handleClick(event) {
    const question=event.target.closest('[data-question-target]');
    if(question) {
      const card=question.closest('.scan-card'), target=card?.querySelector(`[data-section="${question.dataset.questionTarget}"]`), list=find('#scan-card-list');
      if(target && list) { target.open=true; list.scrollTop+=target.getBoundingClientRect().top-list.getBoundingClientRect().top-(card.querySelector('.scan-card-heading')?.getBoundingClientRect().height || 0)-12; target.querySelector('summary').focus({preventScroll:true}); }
      return;
    }

    const scan = event.target.closest('[data-scan-document]');
    if (scan && !scan.disabled) { event.preventDefault(); if (scan.dataset.scanned === 'true') await onOpenScan?.(scan.dataset.scanDocument); else await command(scan.dataset.scanDocument, 'scan'); return; }
    const action = event.target.closest('[data-scan-action]');
    if (action && !action.disabled) { action.disabled = true; await command(action.dataset.id, action.dataset.scanAction, action.dataset.scanAction === 'scan'); return; }
    const nativeRow = event.target.closest('[data-native-document]');
    if (nativeRow && !event.target.closest('[data-document]')) {
      const context = sourceContext();
      try {
        await api(`${endpoint(nativeRow.dataset.nativeDocument)}/open-native`, { method: 'POST', body: {} });
        if (currentSource(context)) notice('Opened in your default app.');
      } catch (error) { if (currentSource(context)) notice(error.message, true); }
      return;
    }
    const original = event.target.closest('[data-open-document]'); if (original) { await openDocument(original.dataset.openDocument); return; }
    const source = event.target.closest('[data-source-document]'); if (source) { await openSource(source.dataset.sourceDocument, Number(source.dataset.sourcePage), source.dataset.reportId, source.dataset.sourceMatch); return; }
    const button = event.target.closest('[data-file-action]'); if (!button || button.disabled) return;
    if (button.dataset.fileAction === 'connect') { await connectionModal(); return; }
    button.disabled = true;
    try {
      if (button.dataset.fileAction === 'jurisdiction') {
        const chosen = chosenJurisdiction(); if (!chosen.regions.length) throw new Error('Choose at least one relevant jurisdiction.');
        await api('/api/scan-settings', { method: 'POST', body: chosen });
        settings = chosen; settingsDirty = false; paintSettings(); notice('Jurisdiction saved. Resume any document that needs clarification.');
      } else if (button.dataset.fileAction === 'readers') {
        const result = await api('/api/readers/setup', { method: 'POST', body: {} }); paintReaders(result); notice(result.message || 'File reader setup started.');
      } else if (button.dataset.fileAction === 'backup') {
        const result = await api('/api/case-backup', { method: 'POST', body: {} }); notice(`Case backup saved: ${result.path}`);
      } else if (button.dataset.fileAction === 'restore') {
        const result = await desktop().restoreCaseBackup();
        if (result?.error) throw new Error(result.error);
        if (result?.restored) notice(`Backup restored to ${result.root}. Open that folder from the current case menu.`);
      }
    } catch (error) { notice(error.message, true); }
    finally { button.disabled = button.dataset.fileAction === 'readers' ? readersInstalling : false; }
  }
  function clearObjectUrls() { for (const url of objectUrls) URL.revokeObjectURL(url); objectUrls.clear(); }
  const sourceContext = () => ({ generation, caseKey: getSession()?.caseKey });
  const currentSource = context => context.generation === generation && context.caseKey === getSession()?.caseKey;
  async function originalPreview(detail, page = 1, time = null, context = sourceContext()) {
    if (!currentSource(context)) return;
    const blob = await api(`${endpoint(detail.id)}/original`, { blob: true });
    if (!currentSource(context)) return;
    clearObjectUrls(); const url = URL.createObjectURL(blob); objectUrls.add(url);
    const extension = (detail.extension || '').toLowerCase(), fragment = time !== null ? `#t=${Math.max(0, Number(time) || 0)}` : `#page=${page}`;
    const preview = extension === '.pdf' ? `<iframe class="scan-original-frame" title="Original document" src="${url}${fragment}"></iframe>` : /\.(mp3|wav|m4a|ogg|flac)$/.test(extension) ? `<audio controls src="${url}${fragment}"></audio>` : /\.(mp4|mov|mkv|webm|avi)$/.test(extension) ? `<video class="scan-original-video" controls src="${url}${fragment}"></video>` : /\.(png|jpe?g|webp|gif)$/.test(extension) ? `<img class="scan-original-image" alt="Original document image" src="${url}">` : '<p>Use Save a copy to open this file in its usual application.</p>';
    showModal(`<h2 class="modal-title">${esc(detail.name)}</h2>${preview}<a class="btn" href="${url}" download="${esc(detail.name)}">Save a copy of original</a>`);
  }
  async function openDocument(id) {
    const context = sourceContext();
    try {
      const detail = await api(endpoint(id)); if (!currentSource(context)) return;
      showModal(`<h2 class="modal-title">${esc(detail.name)}</h2><p class="file-reference">${esc(detail.reference || '')}</p><p>${detail.scan ? esc(scanLabel(detail.scan)) : 'Not scanned. Select Scan in Case desk to begin.'}</p><button class="btn" id="scan-open-original" type="button">Open original</button><div class="scan-document-pages">${(detail.pages || []).map(page => details(`page-${page.page}`, page.anchor?.label || `Page ${page.page}`, `<pre class="source-modal">${esc(page.text || 'No text extracted.')}</pre>`)).join('') || '<p>No extracted text is available yet.</p>'}</div>`);
      document.getElementById('scan-open-original')?.addEventListener('click', () => { void originalPreview(detail, 1, null, context).catch(error => { if (currentSource(context)) notice(error.message, true); }); });
    } catch (error) { if (currentSource(context)) showModal(`<h2 class="modal-title">Document unavailable</h2><p>${esc(error.message)}</p>`); }
  }
  async function openSource(id, page, reportId, sourceMatch) {
    const context = sourceContext();
    try {
      const params = new URLSearchParams({ page: String(page), ...(reportId ? { reportId } : {}), ...(['text_match', 'machine_transcription'].includes(sourceMatch) ? { sourceMatch } : {}) });
      if (sourceMatch === 'visual_observation') {
        const blob = await api(`${endpoint(id)}/image?${params}`, { blob: true });
        if (!currentSource(context)) return;
        clearObjectUrls(); const url = URL.createObjectURL(blob); objectUrls.add(url);
        showModal(`<h2 class="modal-title">Visual source · image ${page}</h2><p>Original image or sampled video frame used by this report.</p><img class="scan-original-image" alt="Source image ${page}" src="${url}">`);
        return;
      }
      const source = await api(`${endpoint(id)}/source?${params}`);
      if (!currentSource(context)) return;
      const location = anchorLabel(source.anchor, page);
      showModal(`<h2 class="modal-title">${esc(source.name || 'Source document')} · ${esc(location)}</h2><pre class="source-modal">${esc(source.text || source.source?.text || 'Text unavailable. Review the original.')}</pre><button class="btn" id="scan-source-original" type="button">Open original at source</button>`);
      document.getElementById('scan-source-original')?.addEventListener('click', async () => {
        if (!currentSource(context)) return;
        try {
          const detail = await api(endpoint(id));
          if (currentSource(context)) await originalPreview(detail, page, source.anchor?.startMs !== undefined ? source.anchor.startMs / 1000 : source.anchor?.startSeconds ?? null, context);
        } catch (error) { if (currentSource(context)) notice(error.message, true); }
      });
    } catch (error) { if (currentSource(context)) notice(error.message, true); }
  }
  async function connectionModal() {
    const native = desktop();
    closeConnectionModal?.();
    showModal(`<h2 class="modal-title">Sign in with ChatGPT</h2><p>Document scans use GPT-6 Astra with Low reasoning through your ChatGPT account. Your account limits apply.</p><p>Original files stay in your case folder. Selected text and images are sent when you select Scan.</p><p id="scan-login-status" role="status" aria-live="polite"></p><div class="ai-auth-actions"><button class="btn chatgpt-signin" type="button" id="scan-login">${chatGPTBrand}</button><button class="btn" type="button" id="scan-cancel-login" hidden>Cancel sign-in</button><button class="btn" type="button" id="scan-check-login" ${native?.chatGPTStatus ? '' : 'disabled'}>Refresh connection</button></div>`);
    const status = document.getElementById('scan-login-status'), login = document.getElementById('scan-login');
    const cancel = document.getElementById('scan-cancel-login'), connection = getChatGPTConnection(native);
    const off = connection.subscribe(result => {
      if (!status.isConnected) return;
      account = result;
      status.textContent = result.error || (!result.available ? 'Sign-in is available in the desktop app.' : result.connected ? 'ChatGPT connected. Return to the document and resume its scan.' : result.signingIn ? 'Finish signing in in your browser. This connection updates automatically.' : result.checking ? 'Checking connection…' : 'Sign in to start scanning.');
      login.disabled = Boolean(result.connected || result.signingIn || result.changing || result.checking || !result.available);
      cancel.hidden = !result.signingIn; cancel.disabled = result.changing || !native?.chatGPTCancelLogin;
    });
    const observer = new status.ownerDocument.defaultView.MutationObserver(() => { if (!status.isConnected) { off(); observer.disconnect(); } });
    observer.observe(document.body, { childList: true, subtree: true });
    closeConnectionModal = () => { off(); observer.disconnect(); };
    login.addEventListener('click', () => void connection.login());
    cancel.addEventListener('click', () => void connection.cancelLogin());
    document.getElementById('scan-check-login')?.addEventListener('click', () => void connection.refresh());
    await connection.refresh();
  }
  return { mount, mountDesk, unmount, refresh, connectionModal, openDocument, upload, open: async id => { openId = id; await refresh(true); } };
}
