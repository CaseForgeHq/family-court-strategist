import { createInbox } from "./inbox.js";
import { createJournal } from "./journal.js";
// Case notes remain portable Markdown. Document intake uses the protected local API.
const STATUS_CLASS = { PROVEN: "proven", DISPUTED: "disp", UNRESOLVED: "unres", DISPROVEN: "dispr" };
const TYPE_CLASS = {
  court: "court", contact: "contact", incident: "incident",
  legal: "court", professional: "pro", communication: "com",
};
const VIEW_TITLES = {
  dashboard: "Case overview", timeline: "Case timeline", evidence: "Evidence matrix",
  patterns: "Patterns", people: "People", documents: "Evidence Vault", journal: "Case journal", exports: "Document Studio", legal: "Legal research",
};

let MODEL = null;
let current = "dashboard";
let SESSION = null;

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
  showModal: openModal, closeModal, onSaved: refreshCase });
const journal = createJournal({ api, getSession: () => SESSION });

async function refreshCase() {
  MODEL = await api("/api/case");
  applyChrome(MODEL);
  if (current !== "documents") go(current);
}

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const titleCase = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1).toLowerCase();
const dayMD = (d) => (d && d.length >= 10 ? d.slice(5).replace("-", "/") : d || "");
function stars(n) {
  n = n || 1;
  return `<span class="stars">${"★".repeat(n)}${n < 3 ? `<span class="o">${"★".repeat(3 - n)}</span>` : ""}</span>`;
}

/* ---------- view renderers (return HTML strings) ---------- */

function timelineRows(items, limit) {
  const list = limit ? items.slice(0, limit) : items;
  if (!list.length) return `<p class="empty">No dated events yet. Add notes with a <code>date</code> and <code>event_id</code> to build your timeline.</p>`;
  return `<div class="tl">${list.map((e) => {
    const c = TYPE_CLASS[e.type] || "court";
    return `<div class="ev"><span class="when">${esc(dayMD(e.date))}</span><span class="mk m-${c}"></span>
      <span class="tx"><b>${esc(e.title)}</b><span class="ty c-${c}">${esc(e.type)}</span>
      <span class="eid">${esc(e.eventId)}</span></span></div>`;
  }).join("")}</div>`;
}

function viewDashboard(m) {
  const pillar = (name) => `<div class="plr"><div class="t"><span>${name}</span><span style="color:var(--soft)">Review sources</span></div></div>`;
  const pat = m.patterns[0]
    ? `<div class="top"><span class="nm">${esc(m.patterns[0].name)}</span><span class="ct">tracked</span></div>
       <div class="desc">Repetition may be relevant, but no fixed count proves a legal pattern.</div>
       <div class="leg">Assess dated sources, context, contrary evidence, and reasonable alternative explanations.</div>`
    : `<p class="empty">No patterns tracked yet.</p>`;
  return `
  <div class="card intake-shortcut"><div><h2>Add a document to your case</h2><p>Read it locally, analyse with your chosen AI, and review sourced findings.</p></div><button class="btn primary" data-go="documents" type="button">Open document inbox</button></div>
  <div class="stats">
    ${statCard("Documents analysed", m.stats.documentsAnalysed, "document notes in your case")}
    ${statCard("Open contradictions", m.stats.openContradictions, "flagged for review", "var(--red)")}
    ${statCard("Patterns tracked", m.stats.patternsTracked, "assess sources, context &amp; alternatives")}
    ${statCard("Timeline events", m.stats.timelineEvents, "dated &amp; identified")}
  </div>
  <div class="row">
    <div class="card">
      <div class="hd"><h2>Evidence Matrix — key claims</h2><span class="mo" data-go="evidence">Open all →</span></div>
      <div class="bd"><table><thead><tr><th>Claim</th><th>Status</th><th>Strength</th></tr></thead>
        <tbody>${evidenceRows(m.evidence)}</tbody></table></div>
    </div>
    <div style="display:flex;flex-direction:column;gap:18px">
      <div class="card"><div class="hd"><h2>Flagged pattern</h2><span class="mo" data-go="patterns">View</span></div><div class="pat">${pat}</div></div>
      <div class="card"><div class="hd"><h2>Case pillars</h2></div><div class="pillars">${pillar("Child's best interests")}${pillar("Credibility contrast")}${pillar("System accountability")}</div></div>
    </div>
  </div>
  <div class="card"><div class="hd"><h2>Recent timeline</h2><span class="mo" data-go="timeline">Open full timeline →</span></div>
    <div class="bd">${timelineRows(m.timeline, 6)}</div></div>
  ${docStudioCard()}`;
}

function statCard(k, v, d, color) {
  return `<div class="stat"><div class="k">${k}</div>
    <div class="v"${color ? ` style="color:${color}"` : ""}>${v}</div><div class="d neu">${d}</div></div>`;
}
function evidenceRows(items) {
  if (!items.length) return `<tr><td colspan="3" class="empty">Reviewed claims will appear here after you save findings from the document inbox. Existing handwritten evidence matrices are not imported yet.</td></tr>`;
  return items.map((r) => `<tr><td class="claim">${esc(r.claim)}<div class="src">${esc(r.source)}</div></td>
    <td><span class="pill ${STATUS_CLASS[r.status] || "unres"}">${titleCase(r.status)}</span></td><td>${r.strength ? stars(r.strength) : "Not assessed"}</td></tr>`).join("");
}
function docStudioCard() {
  return `<div class="card"><div class="docs">
    <div class="pv"><div class="sheet"><div class="h"></div><div class="ln"></div><div class="ln"></div><div class="ln s"></div><div class="ln"></div><div class="ln s"></div></div>
    <div class="sheet"><div class="h" style="width:55%"></div><div class="ln"></div><div class="ln s"></div><div class="ln"></div><div class="ln"></div></div></div>
    <div class="tx"><h2>Document Studio</h2>
    <p>Turn your timeline into a printable draft <b>chronology</b> — clean typography, ready to print or save as PDF. Verify every entry for accuracy and completeness before use.</p>
    <span class="btn" data-action="chronology"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12M7 10l5 5 5-5M5 21h14" stroke-linecap="round" stroke-linejoin="round"/></svg>Generate draft chronology PDF</span></div>
  </div></div>`;
}

function viewTimeline(m) {
  return `<div class="card"><div class="hd"><h2>Master timeline — ${m.timeline.length} events</h2>
    <span class="btn small" data-action="chronology">Export draft chronology PDF</span></div>
    <div class="bd">${timelineRows(m.timeline)}</div></div>`;
}
function viewEvidence(m) {
  return `<div class="card"><div class="hd"><h2>Evidence matrix</h2></div>
    <div class="bd"><table><thead><tr><th>Claim</th><th>Status</th><th>Strength</th></tr></thead>
    <tbody>${evidenceRows(m.evidence)}</tbody></table></div></div>`;
}
function viewPatterns(m) {
  if (!m.patterns.length) return `<div class="card"><div class="bd"><p class="empty">No patterns tracked yet. Create notes with <code>type: pattern</code>.</p></div></div>`;
  return `<div class="cards-list">${m.patterns.map((p) => `<div class="card"><div class="bd">
    <h3 class="li-title">${esc(p.name)}</h3>
    <p class="li-sub">Repetition may be relevant, but no fixed count proves a legal pattern. Assess dated sources, context, contrary evidence, and reasonable alternatives.</p></div></div>`).join("")}</div>`;
}
function viewPeople(m) {
  if (!m.people.length) return `<div class="card"><div class="bd"><p class="empty">No people yet. Create notes with <code>type: person</code>.</p></div></div>`;
  return `<div class="cards-list">${m.people.map((p) => `<div class="card"><div class="bd person">
    <div class="avatar">${esc((p.name[0] || "?").toUpperCase())}</div>
    <div><h3 class="li-title">${esc(p.name)}</h3><p class="li-sub">${esc(p.role || "—")}</p></div></div></div>`).join("")}</div>`;
}
function viewDocuments() {
  return `<div class="cards-list">
    <div class="card"><div class="bd doc-row">
      <div><h3 class="li-title">Printable draft chronology</h3><p class="li-sub">A dated table of timeline events that you can print or save as PDF. Verify accuracy and completeness before use.</p></div>
      <span class="btn" data-action="chronology">Generate draft PDF</span></div></div>
    <div class="card"><div class="bd doc-row">
      <div><h3 class="li-title">Evidence summary <span class="soon">v2</span></h3><p class="li-sub">Claims mapped to evidence with status and strength.</p></div>
      <span class="btn disabled">Coming soon</span></div></div>
    <div class="card"><div class="bd doc-row">
      <div><h3 class="li-title">Solicitor letter <span class="soon">v2</span></h3><p class="li-sub">Professional letter templates with your case details merged in.</p></div>
      <span class="btn disabled">Coming soon</span></div></div>
  </div>`;
}
function viewLegal() {
  return `<div class="card"><div class="bd legal">
    <p>Your vault's <code>legal-research/INDEX.md</code> holds the legal framework for your jurisdiction.
    Rich rendering of legislation and case law lands in a later version.</p>
    <p class="li-sub">Tip: keep the "law current as at" date in that file up to date — family law changes.</p>
  </div></div>`;
}

const VIEWS = {
  dashboard: viewDashboard, timeline: viewTimeline, evidence: viewEvidence,
  patterns: viewPatterns, people: viewPeople, documents: () => "", journal: () => "", exports: viewDocuments, legal: viewLegal,
};

/* ---------- routing ---------- */

function go(view) {
  if (!VIEWS[view]) view = "dashboard";
  current = view;
  inbox.unmount();
  journal.unmount();
  $("view").innerHTML = VIEWS[view](MODEL);
  $("view-title").textContent = VIEW_TITLES[view];
  $("crumb-view").textContent = VIEW_TITLES[view];
  document.querySelectorAll(".nav").forEach((n) => {
    const active = n.dataset.view === view;
    n.classList.toggle("on", active);
    if (active) n.setAttribute("aria-current", "page");
    else n.removeAttribute("aria-current");
  });
  document.querySelector(".main").scrollTop = 0;
  if (view === "documents") inbox.mount($("view"));
  if (view === "journal") void journal.mount($("view"));
  window.scrollTo(0, 0);
}

/* ---------- Shared modal host ---------- */

function openModal(htmlStr) { $("modal-body").innerHTML = htmlStr; $("modal-back").hidden = false; }
function closeModal() { $("modal-back").hidden = true; }

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
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  try {
    const changed = await chooseFolder();
    if (changed) window.location.reload();
  } catch {
    openModal(`
      <h2 class="modal-title">Could not open the folder chooser</h2>
      <p class="modal-p">Try <b>File → Open Case Folder…</b> from the desktop app menu.</p>`);
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
  const rows = m.timeline.length
    ? [...m.timeline].reverse().map((e) => `<tr><td>${esc(e.date)}</td><td>${esc(e.title)}</td><td>${esc(e.type)}</td><td>${esc(e.eventId)}</td></tr>`).join("")
    : `<tr><td colspan="4">No dated events recorded.</td></tr>`;
  $("print-area").innerHTML = `
    <div class="doc">
      <img class="brand-print" src="/brand/logo.svg" alt="Case Forge">
      <h1 class="doc-h1">Draft Chronology of Events</h1>
      <p class="doc-meta">${esc(m.court || m.caseName || "Family law matter")}</p>
      <table class="doc-table"><thead><tr><th>Date</th><th>Event</th><th>Type</th><th>Ref</th></tr></thead>
      <tbody>${rows}</tbody></table>
      <p class="doc-foot">Prepared with Case Forge · printable draft only. Verify accuracy and completeness before use. This is a case-organisation document, not legal advice.</p>
    </div>`;
  document.body.classList.add("printing");
  const cleanup = () => { document.body.classList.remove("printing"); window.removeEventListener("afterprint", cleanup); };
  window.addEventListener("afterprint", cleanup);
  window.print();
}

/* ---------- wire up ---------- */

function bind() {
  document.querySelectorAll(".nav").forEach((n) => n.addEventListener("click", () => go(n.dataset.view)));
  $("current-matter").addEventListener("click", chooseCurrentMatter);
  $("ask-claude").addEventListener("click", () => inbox.connectionModal());
  $("modal-x").addEventListener("click", closeModal);
  $("modal-back").addEventListener("click", (e) => { if (e.target === $("modal-back")) closeModal(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });
  // delegated handlers for dynamically-rendered buttons/links
  $("view").addEventListener("click", (e) => {
    const goEl = e.target.closest("[data-go]");
    if (goEl) { go(goEl.dataset.go); return; }
    const act = e.target.closest("[data-action]");
    if (act && !act.classList.contains("disabled")) {
      if (act.dataset.action === "chronology") generateChronology();
    }
  });
  $("search").addEventListener("input", (e) => filterTimeline(e.target.value));
}

function filterTimeline(q) {
  go("timeline");
  q = q.trim().toLowerCase();
  const filtered = !q ? MODEL.timeline : MODEL.timeline.filter((e) => (e.title + " " + e.eventId + " " + e.type).toLowerCase().includes(q));
  const host = $("view").querySelector(".tl")?.parentElement;
  if (host) host.innerHTML = timelineRows(filtered);
}

function applyChrome(m) {
  $("case-name").textContent = m.caseName || "Case";
  $("current-matter").setAttribute("aria-label", `Current matter: ${m.caseName || "Case"}. Choose a different case folder.`);
  $("case-court").textContent = m.court || "local vault";
  $("count-timeline").textContent = m.stats.timelineEvents;
  $("count-evidence").textContent = m.evidence.length;
  $("count-patterns").textContent = m.patterns.length;
  $("count-people").textContent = m.people.length;
  const b = $("data-banner");
  if (m.empty) {
    b.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01" stroke-linecap="round"/></svg>
      <span><b>Start building your case.</b> Open Documents to add a file and review sourced findings. Existing compatible case notes also appear here.</span>`;
  } else if (m.caseName !== "sample-case") {
    b.hidden = true;
  }
}

async function main() {
  try {
    SESSION = await api("/api/session");
    MODEL = await api("/api/case");
  } catch {
    $("view").innerHTML = `<p class="empty">Could not load the vault.</p>`;
    return;
  }
  applyChrome(MODEL);
  bind();
  go(Object.hasOwn(VIEW_TITLES, window.location.hash.slice(1)) ? window.location.hash.slice(1) : "dashboard");
  window.addEventListener("hashchange", () => {
    const view = window.location.hash.slice(1);
    if (Object.hasOwn(VIEW_TITLES, view)) go(view);
  });
}
main();
