import { createDocumentCreator } from './document-creator.js';
import { createInbox } from "./inbox.js";
import { createJournal } from "./journal.js";
import { createTasks } from "./tasks.js";
import { createCaseMap } from "./graph.js";
import { createCaseDetails } from './case-details.js';
import { createCalendar } from "./calendar.js";
import { createSearch } from "./search.js";
import { createCaseMenu } from './case-menu.js';
import { createAssistant } from "./assistant.js";
import { createUpdates } from './updates.js';
import { createAdmin } from "./admin.js";
import { createNotebook } from './notebook.js';
import { icon } from "./icons.js";
// Case notes remain portable Markdown. Document intake uses the protected local API.
const STATUS_CLASS = { PROVEN: "proven", DISPUTED: "disp", UNRESOLVED: "unres", DISPROVEN: "dispr" };
const TYPE_CLASS = {
  court: "court", contact: "contact", incident: "incident",
  legal: "court", professional: "pro", communication: "com",
};
const VIEW_TITLES = {
  creator: 'Document creator', search: 'Case search',
  notebook: 'Notebook', calendar: "Calendar", dashboard: "Case desk", tasks: "Tasks & deadlines", timeline: "Timeline", evidence: "Evidence matrix", map: "Case map",
  patterns: "Patterns", people: "People", documents: "Files & AI", journal: "Case journal", exports: "Print & export", legal: "Legal research", settings: "Workspace settings",
};

let MODEL = null;
let current = "dashboard";
let SESSION = null;
let setupRequest = 0;
let viewAnimation = null;

async function api(path, options = {}) {
  const headers = { "x-case-id": SESSION?.caseKey || "" };
  if (options.method === "POST") {
    headers["x-strategist-token"] = SESSION?.token || "";
    headers["content-type"] = options.raw ? "application/octet-stream" : "application/json";
  }
  const response = await fetch(path, { method: options.method || "GET", headers,
    body: options.body === undefined ? undefined : options.raw ? options.body : JSON.stringify(options.body) });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.error || "The local app could not complete this request.");
  }
  return options.blob ? response.blob() : response.json();
}

const inbox = createInbox({ api, getSession: () => SESSION, updateSession: (s) => { SESSION = s; },
  showModal: openModal, closeModal, onOpenScan: async id => { await go('documents'); await inbox.open(id); } });
const journal = createJournal({ api, getSession: () => SESSION });
const documentCreator = createDocumentCreator({ api, getSession: () => SESSION });
let documentSeed;
async function openDocumentCreator(seed) { if (!await documentCreator.saveDraft()) return; documentSeed = seed; await go('creator'); }
const notebook = createNotebook({ api, getSession: () => SESSION, onExport: openDocumentCreator });
const tasks = createTasks({ api, getSession: () => SESSION });
const caseMap = createCaseMap({ openRecord, onSelect: id => caseDetails.select(id) });
const caseDetails = createCaseDetails({ openRecord,
  onSelect: id => { if (current === 'map') caseMap.select(id); },
  openMap: async id => { await go('map'); if (id) caseMap.select(id); }
});
caseDetails.mount(document.getElementById('panel-details'));
const calendar = createCalendar({ api, getSession: () => SESSION, openRecord, google: {
  status: () => window.strategistDesktop?.googleStatus?.() || Promise.resolve({available:false,configured:false,connected:false,message:'Google Calendar connection is available in the desktop app.'}),
  configure: () => window.strategistDesktop.googleConfigure(),
  connect: () => window.strategistDesktop.googleConnect(),
  disconnect: () => window.strategistDesktop.googleDisconnect(),
  sync: async ({events}) => window.strategistDesktop.googleSync({caseKey:SESSION.caseKey, ids:events.map(e=>e.id)})
} });
let globalSearch, recordRequest = 0;

async function refreshCase() {
  MODEL = await api("/api/case");
  applyChrome(MODEL);
  if (current !== "documents") go(current);
}

const $ = (id) => document.getElementById(id);
async function loadAppVersion() {
  const desktop = window.strategistDesktop, label = $("app-version");
  label.textContent = desktop ? "Case Forge · version unavailable" : "Browser preview";
  if (typeof desktop?.getAppInfo !== "function") return;
  try {
    const info = await desktop.getAppInfo();
    if (typeof info?.version === "string" && info.version.trim()) label.textContent = `${typeof info.name === "string" && info.name.trim() ? info.name.trim() : "Case Forge"} v${info.version.trim()}`;
  } catch { /* The workspace remains available if version lookup fails. */ }
}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': '&quot;', "'": '&#39;' }[c]));
const titleCase = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1).toLowerCase();
const dayMD = d => /^\d{4}-\d{2}-\d{2}$/.test(d || "") ? new Date(`${d}T12:00:00`).toLocaleDateString("en-AU",{day:"numeric",month:"short",year:"numeric"}) : d || "";
function stars(n) {
  n = n || 1;
  return `<span class="stars">${"★".repeat(n)}${n < 3 ? `<span class="o">${"★".repeat(3 - n)}</span>` : ""}</span>`;
}

/* ---------- view renderers (return HTML strings) ---------- */

function timelineRows(items, limit) {
  const list = limit ? items.slice(0, limit) : items;
  if (!list.length) return `<p class="empty">No dated events yet. Add a file, review its AI findings and save the events you want to keep.</p>`;
  return `<div class="tl">${list.map((e) => {
    const c = TYPE_CLASS[e.type] || "court";
    return `<div class="ev"><span class="when">${esc(dayMD(e.date))}</span><span class="mk m-${c}"></span>
      <span class="tx"><b>${e.reference ? recordLink('note',e.reference,e.title) : esc(e.title)}</b><span class="ty c-${c}">${esc(e.type)}</span>
      <span class="eid">${esc(e.eventId)}</span></span></div>`;
  }).join("")}</div>`;
}

function recordLink(kind,id,label,extra='') {
  return `<a class="record-link ${extra}" href="#record/${kind}/${encodeURIComponent(id)}" data-record-kind="${esc(kind)}" data-record-id="${esc(id)}">${esc(label)}</a>`;
}
function viewDashboard() {
  return '';
}
async function openRecord(kind,id) {
  if(typeof kind === 'object') { id = kind.id; kind = kind.kind; }
  const turn = ++recordRequest;
  globalSearch?.close();
  if(kind === 'document') { closeModal(); await inbox.openDocument(id); return; }
  if(kind === 'task') { closeModal(); await go('tasks'); await tasks.open(id); return; }
  if(kind === 'journal') { closeModal(); await go('journal'); await journal.open(id); return; }
  if(kind === 'notebook') { closeModal(); await go('notebook'); notebook.open(id); return; }
  if(kind === 'calendar') { closeModal(); await go('calendar'); await calendar.open?.(id); return; }
  if(kind === 'fact') {
    try { const fact = await api(`/api/facts/${encodeURIComponent(id)}`); if(turn !== recordRequest) return;
      const latest = fact.revisions.at(-1);
      openModal(`<h2 class="modal-title">${esc(fact.id)}</h2><p>${esc(latest.status)} · revision ${latest.revision}</p><pre class="note-body">${esc(latest.statement)}</pre>${latest.sources.map(s => `<p>${esc(s.path)} · ${esc(s.locator)}</p><pre class="note-body">${esc(s.quote)}</pre>`).join('')}`);
    } catch(error) { openModal(`<p>${esc(error.message)}</p>`); } return;
  }
  if(kind !== 'note') return;
  id = String(id).replace(/^note:/,'');
  if(id.startsWith('source:')) {
    const docs = await api('/api/documents'); const file = docs.documents.find(d=>d.original === id.slice(7));
    if(file) return openRecord('document',file.id);
  }
  id = MODEL.timeline.find(e=>e.eventId === id)?.reference || id;
  try {
    const note = await api(`/api/notes?path=${encodeURIComponent(id)}`); if(turn !== recordRequest) return;
    openModal(`<h2 class="modal-title">${esc(note.title)}</h2><p class="note-meta">${esc(note.reference)}</p><pre class="note-body">${esc(note.body)}</pre><div class="note-links">${note.source ? recordLink('document',note.source.id,`${note.source.reference || 'Source file'} · ${note.source.name}`) : ''}${note.related.map(n=>recordLink('note',n.id,n.label)).join('')}</div>`);
  } catch(error) { if(turn === recordRequest) openModal(`<h2 class="modal-title">Record unavailable</h2><p class="modal-p">${esc(error.message)}</p>`); }
}

function viewSettings() {
  const native = window.strategistDesktop;
  return `
  <section class="page-purpose purpose-with-action">
    <div><p>Make this workspace yours.</p><span>Manage your PIN and the folder where your case belongs.</span></div>
    <button type="button" class="home-reset-link text-button" data-action="reset-session" ${native?.resetSession && native?.getSetupState ? "" : "disabled"}>Start fresh session <span aria-hidden="true">↻</span></button>
  </section>
  <section class="home-setup-cards" aria-label="Your workspace settings">
    <article class="home-setup-card pin-card"><div class="setup-card-top"><span class="setup-card-icon" aria-hidden="true"><svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="11" y="21" width="26" height="22" rx="5"/><path d="M16 21v-7a8 8 0 0 1 16 0v7M24 30v5"/></svg></span><span class="setup-step">01 / YOUR ACCESS</span></div>
      <h3>Configure your PIN.</h3><p>A simple way to lock your workspace when you step away.</p><div class="setup-card-status" id="home-pin-status" role="status">${native?.getSetupState ? "Checking your PIN settings…" : "Available in the desktop app"}</div>
      <button type="button" class="setup-main-button" id="home-configure-pin" data-action="configure-pin" ${native?.configurePin && native?.getSetupState ? "" : "disabled"}>Configure PIN <span aria-hidden="true">↗</span></button>
      <small>Your PIN locks the app. It does not encrypt files outside it.</small>
    </article>
    <article class="home-setup-card folder-card"><div class="setup-card-top"><span class="setup-card-icon" aria-hidden="true"><svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 16V11a3 3 0 0 1 3-3h10l5 6h15a3 3 0 0 1 3 3v21a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3V16Z"/><path d="M6 20h36M24 27v8m-4-4h8"/></svg></span><span class="setup-step">02 / YOUR FILES</span></div>
      <h3>A place for your case.</h3><p>Choose the folder on this computer where your case files belong.</p><div class="setup-card-status" id="home-folder-status" role="status">${native?.getSetupState ? "Checking your case folder…" : "Choose a folder in the desktop app"}</div><p class="setup-folder-path" id="home-folder-path"></p>
      <button type="button" class="setup-main-button" data-action="choose-folder" ${native?.chooseCaseFolder ? "" : "disabled"}>Choose case folder <span aria-hidden="true">↗</span></button>
      <button type="button" class="setup-small-button" data-action="create-folder" ${native?.createCase ? "" : "disabled"}>Or create a new case folder</button>
    </article>
  </section>
  <p class="home-setup-notice" id="home-setup-notice" role="status">${native?.getSetupState ? "" : "Open Case Forge on your desktop to configure your PIN and storage location."}</p>
  `;
}

function statCard(k, v, d, color) {
  return `<div class="stat"><div class="k">${k}</div>
    <div class="v"${color ? ` style="color:${color}"` : ""}>${v}</div><div class="d neu">${d}</div></div>`;
}
function evidenceRows(items) {
  if (!items.length) return `<tr><td colspan="3" class="empty">Claims will appear here after you review and save findings in Files &amp; AI.</td></tr>`;
  return items.map((r) => `<tr><td class="claim">${r.reference ? recordLink('note',r.reference,r.claim) : esc(r.claim)}<div class="src">${esc(r.source)}</div></td>
    <td><span class="pill ${STATUS_CLASS[r.status] || "unres"}">${titleCase(r.status)}</span></td><td>${r.strength ? stars(r.strength) : "Not assessed"}</td></tr>`).join("");
}
function docStudioCard() {
  return `<div class="card"><div class="docs">
    <div class="pv"><div class="sheet"><div class="h"></div><div class="ln"></div><div class="ln"></div><div class="ln s"></div><div class="ln"></div><div class="ln s"></div></div>
    <div class="sheet"><div class="h" style="width:55%"></div><div class="ln"></div><div class="ln s"></div><div class="ln"></div><div class="ln"></div></div></div>
    <div class="tx"><h2>Document Studio</h2>
    <p>Turn your timeline into a printable draft <b>chronology</b> — clean typography, ready to print or save as PDF. Verify every entry for accuracy and completeness before use.</p>
    <button type="button" class="btn" data-action="chronology"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12M7 10l5 5 5-5M5 21h14" stroke-linecap="round" stroke-linejoin="round"/></svg>Generate draft chronology PDF</button></div>
  </div></div>`;
}

function viewTimeline(m) {
  return `<div class="page-purpose"><p>What happened, in date order.</p><span>Events come from your case notes and findings you review and save in Files &amp; AI. Dated events also appear in Calendar.</span></div><div class="card"><div class="hd"><h2>${m.timeline.length} recorded events</h2><button class="btn" type="button" data-go="calendar">${icon('calendar')} Calendar</button>
    <button type="button" class="btn small" data-action="chronology">Export draft chronology PDF</button></div>
    <div class="bd">${timelineRows(m.timeline)}</div></div>`;
}
function viewEvidence(m) {
  return `<div class="page-purpose"><p>Review each claim alongside its source.</p><span>Findings you approve in Files &amp; AI appear here with their recorded status.</span></div><div class="card"><div class="hd"><h2>Evidence matrix</h2></div>
    <div class="bd"><table><thead><tr><th>Claim</th><th>Status</th><th>Strength</th></tr></thead>
    <tbody>${evidenceRows(m.evidence)}</tbody></table></div></div>`;
}
function viewPatterns(m) {
  const purpose = `<div class="page-purpose"><p>Explore recurring themes in your records.</p><span>Open a theme to check its sources and context. A recorded pattern is not a verified conclusion.</span></div>`;
  if (!m.patterns.length) return purpose + `<div class="card"><div class="bd"><p class="empty">No patterns recorded yet. Patterns from your existing case notes will appear here.</p></div></div>`;
  return purpose + `<div class="cards-list">${m.patterns.map((p) => `<div class="card"><div class="bd">
    <h3 class="li-title">${p.reference ? recordLink('note',p.reference,p.name) : esc(p.name)}</h3>
    <p class="li-sub">Repetition may be relevant, but no fixed count proves a legal pattern. Assess dated sources, context, contrary evidence, and reasonable alternatives.</p></div></div>`).join("")}</div>`;
}
function viewPeople(m) {
  return `<div class="page-purpose purpose-with-action"><div><p>The people involved in your case.</p><span>Keep their names and roles here. Add a person and link an event to connect them on the case map.</span></div><button type="button" class="btn primary" id="add-person" ${SESSION?.access?.canWrite ? '' : 'disabled'}>${icon('plus')} Add person</button></div><div class="people-grid">${!m.people.length ? '<p class="empty">Start with a person. People already recorded in your case notes also appear here.</p>' : m.people.map((p) => `<div class="card"><div class="bd person">
    <div class="avatar">${esc((p.name[0] || "?").toUpperCase())}</div>
    <div><h3 class="li-title">${p.reference ? recordLink('note',p.reference,p.name) : esc(p.name)}</h3><p class="li-sub">${esc(p.role || "Role not recorded")}</p><button class="btn small" data-edit-person="${esc(p.reference)}">Details & connections</button></div></div></div>`).join("")}</div>`;
}
function viewDocuments() {
  return `<div class="page-purpose"><p>Prepare a copy you can print or share.</p><span>Generate a draft chronology from Timeline. Check the entries before using it.</span></div><div class="cards-list">
    <div class="card"><div class="bd doc-row">
      <div><h3 class="li-title">Printable draft chronology</h3><p class="li-sub">A dated table of timeline events that you can print or save as PDF. Verify accuracy and completeness before use.</p></div>
      <button type="button" class="btn" data-action="chronology">Generate draft PDF</button></div></div>
    <div class="card"><div class="bd doc-row">
      <div><h3 class="li-title">Evidence summary <span class="soon">v2</span></h3><p class="li-sub">Claims mapped to evidence with status and strength.</p></div>
      <span class="btn disabled">Coming soon</span></div></div>
    <div class="card"><div class="bd doc-row">
      <div><h3 class="li-title">Solicitor letter <span class="soon">v2</span></h3><p class="li-sub">Professional letter templates with your case details merged in.</p></div>
      <span class="btn disabled">Coming soon</span></div></div>
  </div>`;
}
let personPending = null;
function addPersonForm(person) {
  const writable = SESSION?.access?.canWrite;
  openModal(`<h2 class="modal-title">${person ? 'Person details & connections' : 'Add a person'}</h2><p class="modal-p">Changes save automatically in this case. Connections also appear on the case map.</p><form id="person-form" class="person-form"><fieldset ${writable ? '' : 'disabled'} style="border:0;padding:0"><label>Name<input name="name" maxlength="120" required autocomplete="off" value="${esc(person?.name || '')}"></label><label>Role<input name="role" maxlength="120" value="${esc(person?.role || '')}" placeholder="For example: parent, lawyer or teacher"></label><label>Link to an event <span>(optional)</span><select name="related"><option value="">No linked event</option>${MODEL.timeline.map(event => `<option value="${esc(event.reference)}" ${person?.related?.includes(event.reference) ? 'selected' : ''}>${esc(event.title)}</option>`).join('')}</select></label><label>Notes <span>(optional)</span><textarea name="notes" maxlength="3000" rows="3">${esc(person?.notes || '')}</textarea></label><fieldset><legend>Connected people</legend>${MODEL.people.filter(p => p.reference !== person?.reference).map(p => `<label><input type="checkbox" name="connection" value="${esc(p.reference)}" ${person?.related?.includes(p.reference) ? 'checked' : ''}> ${esc(p.name)}</label>`).join('') || '<p>Add another person to create a connection.</p>'}</fieldset><p id="person-message" role="status">${person ? 'Saved on this computer' : 'Enter a name to start saving.'}</p><button class="btn primary" type="submit">${icon('check')} Save now</button></fieldset></form>`);
  const form = $('person-form'), message = $('person-message'), caseKey = SESSION.caseKey;
  let reference = person?.reference, revision = person?.revision, timer, running = null, dirty = false;
  const warn = event => { if (dirty || running) { event.preventDefault(); event.returnValue = ''; } };
  window.addEventListener('beforeunload', warn);
  const capture = () => ({ name: form.elements.name.value, role: form.elements.role.value, notes: form.elements.notes.value, related: form.elements.related.value, connections: [...form.querySelectorAll('[name="connection"]:checked')].map(input => input.value) });
  async function save() {
    clearTimeout(timer);
    if (running) { await running; return dirty ? save() : true; }
    if (!dirty) return true;
    if (!writable || SESSION.caseKey !== caseKey) return false;
    if (!form.reportValidity()) { message.textContent = 'Enter a name before saving.'; return false; }
    const snapshot = capture(); message.textContent = 'Saving…';
    running = (async () => {
      try {
        const saved = await api('/api/people', { method: 'POST', body: { ...snapshot, reference, expectedRevision: revision } });
        reference = saved.reference; revision = saved.revision;
        dirty = JSON.stringify(snapshot) !== JSON.stringify(capture());
        message.textContent = dirty ? 'Waiting to save…' : 'Saved on this computer';
        if (SESSION.caseKey === caseKey) { MODEL = await api('/api/case'); applyChrome(MODEL); }
        return true;
      } catch (error) { message.textContent = `Not saved: ${error.message}`; return false; }
      finally { running = null; }
    })();
    const ok = await running;
    if (ok && dirty) return save();
    return ok;
  }
  personPending = { async flush() { const ok = await save(); if (ok) { window.removeEventListener('beforeunload', warn); personPending = null; if (current === 'people') await go('people'); } return ok; } };
  form.addEventListener('input', () => { dirty = true; message.textContent = 'Waiting to save…'; clearTimeout(timer); timer = setTimeout(() => void save(), 700); });
  form.addEventListener('submit', event => { event.preventDefault(); void save(); });
  form.elements.name.focus();
}
function viewLegal() {
  const notes = MODEL.graph.nodes.filter(n => n.id.startsWith('legal-research/') && !n.id.startsWith('source:'));
  return `<div class="page-purpose"><p>Keep your research close to your case.</p><span>Your saved research notes. Check the jurisdiction and date before relying on them.</span></div><section class="card"><div class="hd"><h2>Research notes</h2></div><div class="bd">${notes.length ? `<div class="note-links">${notes.map(n=>recordLink('note',n.id,n.label)).join('')}</div>` : '<p class="empty">No research notes yet. Markdown notes in your case folder’s legal-research folder appear here.</p>'}</div></section>`;
}

const VIEWS = {
  creator: () => '', search: () => '',
  notebook: () => '', calendar: () => "", dashboard: viewDashboard, settings: viewSettings, tasks: () => "", timeline: viewTimeline, evidence: viewEvidence,
  patterns: viewPatterns, people: viewPeople, documents: () => "", journal: () => "", exports: viewDocuments, legal: viewLegal, map: () => "",
};

/* ---------- routing ---------- */

async function go(view) {
  if (!VIEWS[view]) view = "dashboard";
  current = view;
  recordRequest++;
  globalSearch?.close();
  globalSearch?.unmount();
  document.body.dataset.workspaceView = view;
  viewAnimation?.cancel();
  inbox.unmount();
  journal.unmount();
  notebook.unmount();
  documentCreator.unmount();
  tasks.unmount();
  caseMap.unmount();
  calendar.unmount();
  $("view").innerHTML = VIEWS[view](MODEL);
  $("view-title").textContent = VIEW_TITLES[view];
  document.querySelectorAll(".nav,.workspace-settings").forEach((n) => {
    const active = n.dataset.view === view;
    n.classList.toggle("on", active);
    if (active) n.setAttribute("aria-current", "page");
    else n.removeAttribute("aria-current");

  });
  document.querySelectorAll('.workspace-nav > details').forEach(group => { group.classList.toggle('has-active-page', Boolean(group.querySelector('.nav.on'))); });
  $("search").hidden = false;
  $("ask-claude").hidden = false;
  const mainElement = document.querySelector(".main");
  mainElement.scrollTop = 0;
  $("view").scrollTop = 0;
  // Reset again after layout so navigation cannot retain an old view's scroll anchor.
  window.requestAnimationFrame?.(() => { if (current === view && mainElement.isConnected) { mainElement.scrollTop = 0; $("view").scrollTop = 0; } });
  if (view === "documents") inbox.mount($("view"));
  if (view === 'search') await globalSearch.mount($('view'));
  if (view === "journal") await journal.mount($("view"));
  if (view === 'creator') { const seed = documentSeed; documentSeed = null; await documentCreator.mount($('view'), seed); }
  if (view === 'notebook') await notebook.mount($('view'));
  if (view === 'people') { $('add-person')?.addEventListener('click', () => addPersonForm()); document.querySelectorAll('[data-edit-person]').forEach(button => button.addEventListener('click', () => addPersonForm(MODEL.people.find(p => p.reference === button.dataset.editPerson)))); }
  if (view === "tasks") await tasks.mount($("view"));
  if (view === "calendar") await calendar.mount($("view"));
  if (view === "dashboard") inbox.mountDesk($("view"));
  if(current !== view) return;
  if (view === "map") { caseMap.mount($("view"), MODEL); caseMap.select(caseDetails.getSelection()); }
  if (view === "settings") void refreshHomeSetup();
  if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) viewAnimation = $("view").animate?.([{ opacity:.3,transform:'translateY(6px)' },{ opacity:1,transform:'translateY(0)' }],{ duration:180,easing:'ease-out' });
  window.dispatchEvent(new window.CustomEvent('caseforge:view',{ detail:{ view } }));
  window.scrollTo(0, 0);
}

/* ---------- Shared modal host ---------- */

function openModal(htmlStr) { $("modal-body").innerHTML = htmlStr; $("modal-back").hidden = false; }
async function closeModal() { if (personPending && !await personPending.flush()) return; $("modal-back").hidden = true; $("modal-body").querySelectorAll('input[type="password"]').forEach((input) => { input.value = ""; }); }

async function readSetupState() {
  const state = await window.strategistDesktop.getSetupState();
  if (state.error) throw new Error(state.error);
  return state;
}
async function refreshHomeSetup() {
  if (!window.strategistDesktop?.getSetupState) return;
  const request = ++setupRequest;
  try {
    const state = await readSetupState();
    if (request !== setupRequest || current !== "settings") return;
    $("home-pin-status").textContent = state.pinConfigured ? "PIN configured · your app lock is ready" : "No PIN configured yet";
    $("home-folder-status").textContent = state.folderSelected ? `Selected: ${state.folderName || "Your case folder"}` : "No case folder selected yet";
    $("home-folder-path").textContent = state.folderSelected ? state.folderPath || "" : "";
  } catch (error) { if (request === setupRequest && current === "settings") $("home-setup-notice").textContent = error.message; }
}
const pinField = (id, label, currentPin = false) => `<label for="${id}">${label}<input id="${id}" name="${id}" type="password" inputmode="numeric" pattern="[0-9]{6,12}" minlength="6" maxlength="12" required autocomplete="${currentPin ? "current-password" : "new-password"}" placeholder="6–12 digits"></label>`;
async function configurePinModal() {
  if (!window.strategistDesktop?.configurePin) return;
  let state;
  try { state = await readSetupState(); }
  catch (error) { $("home-setup-notice").textContent = error.message; return; }
  openModal(`<h2 class="modal-title">${state.pinConfigured ? "Update your PIN" : "Configure your PIN"}</h2><p class="modal-p">Choose 6 to 12 digits you can remember. Your PIN locks Case Forge; your case files remain ordinary local files.</p>
    <form id="home-pin-form" class="connection-form">${state.pinConfigured ? pinField("home-current-pin", "Your current PIN", true) : ""}${pinField("home-new-pin", "Your new PIN")}${pinField("home-confirm-pin", "Enter your new PIN again")}<p id="home-pin-message" role="status" class="inbox-message"></p><button class="btn primary" id="home-pin-submit" type="submit">Save PIN</button><button class="btn" type="button" id="home-pin-cancel">Cancel</button></form>`);
  $(state.pinConfigured ? "home-current-pin" : "home-new-pin").focus();
  $("home-pin-cancel").addEventListener("click", closeModal);
  $("home-pin-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = $("home-pin-submit"), message = $("home-pin-message");
    if (button.disabled) return;
    button.disabled = true; message.textContent = "Saving your PIN…";
    const values = { currentPin: $("home-current-pin")?.value || "", newPin: $("home-new-pin").value, confirmation: $("home-confirm-pin").value };
    $("home-pin-form").querySelectorAll("input").forEach((input) => { input.value = ""; });
    try {
      const result = await window.strategistDesktop.configurePin(values);
      if (!result?.ok) throw new Error(result?.error || "Your PIN could not be saved. Please try again.");
      closeModal(); await refreshHomeSetup(); if (current === "settings") $("home-setup-notice").textContent = "Your PIN has been saved.";
    } catch (error) { message.textContent = error.message; button.disabled = false; }
  });
}
async function resetSessionModal() {
  if (!window.strategistDesktop?.resetSession) return;
  let state;
  try { state = await readSetupState(); }
  catch (error) { $("home-setup-notice").textContent = error.message; return; }
  openModal(`<h2 class="modal-title">Start a fresh session?</h2><p class="modal-p">Your saved case files will stay in their current folders.</p><ul class="modal-steps"><li>Your PIN and remembered case folder will be reset.</li><li>Unsaved drafts and your AI connection will be cleared.</li><li>You will return to the setup screen.</li></ul>
    <form id="home-reset-form" class="connection-form">${state.pinConfigured ? pinField("reset-current-pin", "Your current PIN", true) : ""}<label class="reset-confirmation"><input type="checkbox" id="reset-confirm" required><span>I have saved my work and want to reset this session.</span></label><p id="home-reset-message" role="status" class="inbox-message"></p><button class="btn primary" id="home-reset-submit" type="submit">Start fresh session</button><button class="btn" type="button" id="home-reset-cancel">Keep this session</button></form>`);
  $(state.pinConfigured ? "reset-current-pin" : "reset-confirm").focus();
  $("home-reset-cancel").addEventListener("click", closeModal);
  $("home-reset-form").addEventListener("submit", async (event) => {
    event.preventDefault(); const button = $("home-reset-submit"), message = $("home-reset-message");
    if (button.disabled) return;
    if (!$("reset-confirm").checked) { message.textContent = "Confirm that you have saved your work before starting fresh."; return; }
    button.disabled = true; message.textContent = "Starting a fresh session…";
    const currentPin = $("reset-current-pin")?.value || "";
    if ($("reset-current-pin")) $("reset-current-pin").value = "";
    try {
      const result = await window.strategistDesktop.resetSession({ currentPin, confirmed: true });
      if (!result?.ok) throw new Error(result?.error || "The session could not be reset. Please try again.");
    } catch (error) { message.textContent = error.message; button.disabled = false; }
  });
}

async function chooseCurrentMatter() {
  const chooseFolder = window.strategistDesktop?.chooseCaseFolder;
  if (typeof chooseFolder !== "function") {
    openModal(`
      <h2 class="modal-title">Choose a case folder in the desktop app</h2>
      <p class="modal-p">A web browser cannot safely choose a folder for this local workspace.</p>
      <p class="modal-p">Open <b>Case Forge</b> on your computer, then click its <b>Current matter</b> button or choose <b>File → Open Case Folder…</b>.</p>`);
    return;
  }

  const button = $("current-matter");
  if (button.disabled) return;
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  try {
    const changed = await chooseFolder();
    if (changed?.error) throw new Error(changed.error);
    if (changed) window.location.reload();
  } catch (error) {
    openModal(`
      <h2 class="modal-title">Could not open the folder chooser</h2>
      <p class="modal-p">${esc(error.message || "Try File → Open Case Folder… from the desktop app menu.")}</p>`);
  } finally {
    button.disabled = false;
    button.removeAttribute("aria-busy");
  }
}

/* ---------- Document Studio: chronology → print/PDF ---------- */

async function generateChronology() {
  let m;
  try { m = await api("/api/exports/chronology", { method: "POST", body: {} }); }
  catch (error) {
    openModal(`<h2 class="modal-title">Could not generate chronology</h2><p class="modal-p">${esc(error.message)}</p>`);
    return;
  }
  await openDocumentCreator({ title: 'Draft Chronology of Events', body: [...m.timeline].reverse().map(e => `${e.date} — ${e.title}\nType: ${e.type} · Reference: ${e.eventId}`).join('\n\n') || 'No dated events recorded.' });
}

/* ---------- wire up ---------- */

function bind() {
  document.querySelectorAll(".nav,.workspace-settings").forEach((n) => n.addEventListener("click", () => go(n.dataset.view)));
  createCaseMenu({ desktop: window.strategistDesktop, getName: () => MODEL.caseName, settings: () => go('settings'), chooseFolder: chooseCurrentMatter,
    createCase: () => $('new-case').click(), showError: message => openModal(`<h2 class="modal-title">Could not close this case</h2><p>${esc(message)}</p>`) });
  const newCaseButton = $("new-case");
  if (typeof window.strategistDesktop?.createCase === "function") {
    newCaseButton.hidden = false;
    newCaseButton.addEventListener("click", async () => {
      newCaseButton.disabled = true;
      try { const result = await window.strategistDesktop.createCase(); if (result?.error) throw new Error(result.error); if (result) window.location.reload(); }
      catch (error) { openModal(`<h2 class="modal-title">Could not create your case folder</h2><p class="modal-p">${esc(error.message || "Try a new folder name in a location you can write to.")}</p>`); }
      finally { newCaseButton.disabled = false; }
    });
  }
  $("ask-claude").addEventListener("click", () => window.dispatchEvent(new window.CustomEvent('caseforge:open-panel',{detail:{name:'ai'}})));
  createAssistant({desktop:window.strategistDesktop});
  createAdmin({desktop:window.strategistDesktop});
  createUpdates({desktop:window.strategistDesktop});
  globalSearch = createSearch({api,openRecord,go,desktop:window.strategistDesktop,getSession:()=>SESSION});
  const lockButton = $("lock-app");
  if (typeof window.strategistDesktop?.lock === "function") {
    lockButton.hidden = false;
    lockButton.addEventListener("click", async () => {
      try { await window.strategistDesktop.lock(); }
      catch { openModal(`<h2 class="modal-title">Could not lock the app</h2><p class="modal-p">Use your computer's lock screen to keep your workspace private.</p>`); }
    });
  }
  $("modal-x").addEventListener("click", closeModal);
  $("modal-back").addEventListener("click", (e) => { if (e.target === $("modal-back")) closeModal(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });
  // delegated handlers for dynamically-rendered buttons/links
  document.addEventListener("click", (e) => {
    const record = e.target.closest('[data-record-kind]');
    if(record) { e.preventDefault(); void openRecord(record.dataset.recordKind,record.dataset.recordId); return; }
    const goEl = e.target.closest("[data-go]");
    if (goEl) { go(goEl.dataset.go); return; }
    const act = e.target.closest("[data-action]");
    if (act && !act.disabled && !act.classList.contains("disabled")) {
      if (act.dataset.action === "chronology") generateChronology();
      if (act.dataset.action === "ai-settings") inbox.connectionModal();
      if (act.dataset.action === "configure-pin") void configurePinModal();
      if (act.dataset.action === "choose-folder") void chooseCurrentMatter();
      if (act.dataset.action === "create-folder") $("new-case").click();
      if (act.dataset.action === "reset-session") void resetSessionModal();
    }
  });

}


function applyChrome(m) {
  $("case-name").textContent = m.caseName || "Case";
  $("current-matter").title = m.caseName || "Case";
  $("current-matter").setAttribute('aria-label', `Current case: ${m.caseName || "Case"}. Open case menu.`);
  caseDetails.update(m, SESSION?.caseKey);
  $("count-timeline").textContent = m.stats.timelineEvents;
  $("count-evidence").textContent = m.evidence.length;
  $("count-patterns").textContent = m.patterns.length;
  $("count-people").textContent = m.people.length;
  const b = $("data-banner");
  if (m.isSample === true || m.caseName === "sample-case") {
    b.innerHTML = `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg><span><b>Example case.</b> Fictional records.</span>`;
    b.hidden = false;
  } else {
    b.hidden = true;
  }
}

async function main() {
  void loadAppVersion();
  try {
    SESSION = await api("/api/session");
    MODEL = await api("/api/case");
  } catch {
    $("view").innerHTML = `<p class="empty">Could not load the vault.</p>`;
    return;
  }
  applyChrome(MODEL);
  bind();
  function route() {
    const hash = window.location.hash.slice(1);
    if(hash.startsWith('record/')) { const [,kind,...parts] = hash.split('/'); void openRecord(kind,decodeURIComponent(parts.join('/'))); }
    else void go(Object.hasOwn(VIEW_TITLES,hash) ? hash : 'dashboard');
  }
  route(); window.addEventListener('hashchange',route);
}
main();
