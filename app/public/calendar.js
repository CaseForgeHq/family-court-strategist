import { icon } from "./icons.js";
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const dayKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const fromKey = key => { const [y, m, d] = key.split("-").map(Number); const date = new Date(0); date.setFullYear(y, m - 1, d); date.setHours(12, 0, 0, 0); return date; };
const label = { manual: "Personal event", task: "Task", timeline: "Timeline" };
const dateLabel = { confirmed: "Confirmed date", proposed: "Proposed · needs review", review_required: "Source changed · needs review", recorded: "Recorded event", personal: "Personal date" };

export function createCalendar({ api, getSession, openRecord, google }) {
  let host = null, generation = 0, caseKey, events = [], access = {}, selectedDay = dayKey(new Date()), month = fromKey(selectedDay), draft = null;
  let selected = new Set(), showInactive = false, busy = false, googleBusy = false, googleOpen = false, googlePoll = null, googleState = { available: Boolean(google), configured: false, connected: false };
  const find = selector => host?.querySelector(selector);
  const notice = (message, error = false) => { const node = find("#calendar-message"); if (node) { node.textContent = message; node.classList.toggle("error", error); } };
  const unload = event => { if (draft) { event.preventDefault(); event.returnValue = ""; } };
  function setDraft(value) { draft = value; window.removeEventListener("beforeunload", unload); if (draft) window.addEventListener("beforeunload", unload); }
  function unmount() { generation++; clearTimeout(googlePoll); googlePoll = null; host = null; }
  const active = event => showInactive || event.status === "active";
  async function mount(element) {
    unmount(); host = element;
    if (caseKey !== getSession().caseKey) { setDraft(null); selected = new Set(); selectedDay = dayKey(new Date()); month = fromKey(selectedDay); showInactive = false; events = []; }
    caseKey = getSession().caseKey; access = getSession().access || {};
    host.innerHTML = `<section class="calendar-workspace" aria-label="Case calendar"><div class="page-purpose"><p>Your dates, in one place.</p><span>Personal events, task dates and recorded Timeline events. Select entries to send a copy to Google Calendar.</span></div>
      <div class="calendar-toolbar"><div class="calendar-month-controls"><button type="button" class="btn small" id="calendar-prev" aria-label="Previous month">${icon("chevron")}</button><h2 id="calendar-month-title"></h2><button type="button" class="btn small" id="calendar-next" aria-label="Next month">${icon("chevron")}</button><button type="button" class="btn small" id="calendar-today">Today</button></div>
      <div class="calendar-actions"><button type="button" class="btn" id="calendar-sync" disabled>Sync selected</button><button type="button" class="btn" id="calendar-google-toggle" aria-expanded="false" aria-controls="calendar-google">${icon("calendar")} Google Calendar</button><button type="button" class="btn primary" id="calendar-new" ${access.canWrite ? "" : "disabled"}>${icon("plus")} New event</button></div></div>
      <section class="calendar-google card" id="calendar-google" aria-label="Google Calendar connection" hidden></section>
      <div class="calendar-sync-bar"><p id="calendar-selection">Select an event to send to Google.</p></div>
      <p class="calendar-message" id="calendar-message" role="status" aria-live="polite"></p>
      <div class="calendar-layout"><section class="calendar-month card" aria-labelledby="calendar-month-title"><div class="calendar-weekdays" aria-hidden="true">${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(day => `<span>${day}</span>`).join("")}</div><div class="calendar-grid" id="calendar-grid"></div><div class="calendar-legend"><span><i class="calendar-dot manual"></i>Personal</span><span><i class="calendar-dot task"></i>Tasks</span><span><i class="calendar-dot timeline"></i>Timeline</span></div></section>
      <section class="calendar-agenda card" aria-label="Events on selected date"><div class="calendar-agenda-head"><h2 id="calendar-agenda-title"></h2><label class="calendar-inactive"><input type="checkbox" id="calendar-inactive"> Show completed &amp; archived</label></div><div id="calendar-agenda"></div></section></div>
      
      <p class="calendar-footnote">All-day dates. Confirm task dates in Tasks &amp; deadlines; check any required cut-off time separately.</p>
      <section class="calendar-editor card" id="calendar-editor" hidden></section>
    </section>`;
    find("#calendar-prev").addEventListener("click", () => moveMonth(-1));
    find("#calendar-next").addEventListener("click", () => moveMonth(1));
    find("#calendar-today").addEventListener("click", () => { selectedDay = dayKey(new Date()); month = fromKey(selectedDay); render(); });
    find("#calendar-new").addEventListener("click", () => edit());
    find("#calendar-inactive").checked = showInactive;
    find("#calendar-inactive").addEventListener("change", event => { showInactive = event.target.checked; render(); });
    find("#calendar-google-toggle").addEventListener("click", () => { googleOpen = !googleOpen; renderGoogle(); });
    find(".calendar-workspace").addEventListener("keydown", event => { if (event.key === "Escape" && googleOpen) { event.preventDefault(); event.stopPropagation(); googleOpen = false; renderGoogle(); find("#calendar-google-toggle").focus(); } });
    find("#calendar-sync").addEventListener("click", () => void sync());
    render(); if (draft) renderEditor();
    await Promise.all([refresh(), refreshGoogle()]);
  }
  async function refresh() {
    const turn = generation;
    try {
      const result = await api("/api/calendar");
      if (!host || turn !== generation) return;
      events = result.events || []; access = result.access || getSession().access || {};
      selected = new Set([...selected].filter(id => events.some(event => event.id === id && event.syncable)));
      find("#calendar-new").disabled = !access.canWrite || busy; render();
    } catch (error) { if (host && turn === generation) notice(error.message, true); }
  }
  function moveMonth(offset) { month = new Date(month.getFullYear(), month.getMonth() + offset, 1, 12); selectedDay = dayKey(month); render(); }
  function render() {
    if (!host) return;
    find("#calendar-month-title").textContent = month.toLocaleDateString("en-AU", { month: "long", year: "numeric" });
    const first = new Date(month.getFullYear(), month.getMonth(), 1, 12), start = new Date(first);
    start.setDate(1 - (first.getDay() + 6) % 7);
    const today = dayKey(new Date());
    find("#calendar-grid").innerHTML = Array.from({ length: 42 }, (_, i) => {
      const day = new Date(start); day.setDate(start.getDate() + i); const key = dayKey(day), matches = events.filter(event => event.date === key && active(event));
      return `<button type="button" class="calendar-day ${day.getMonth() !== month.getMonth() ? "outside" : ""} ${key === selectedDay ? "selected" : ""} ${key === today ? "today" : ""}" data-date="${key}" aria-pressed="${key === selectedDay}" ${key === today ? 'aria-current="date"' : ""} aria-label="${esc(day.toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", year: "numeric" }))}, ${matches.length} ${matches.length === 1 ? "event" : "events"}"><span class="calendar-day-number">${day.getDate()}</span><span class="calendar-day-events">${matches.length ? `<span class="calendar-day-total">${matches.length} ${matches.length === 1 ? 'event' : 'events'}</span>` : ''}${matches.slice(0, 2).map(event => `<span class="calendar-cell-event ${esc(event.kind)}" title="${esc(event.title)}"><i class="calendar-dot ${esc(event.kind)}"></i><span>${esc(event.title)}</span></span>`).join("")}${matches.length > 2 ? `<span class="calendar-more">+${matches.length - 2} more</span>` : ""}</span></button>`;
    }).join("");
    find("#calendar-grid").querySelectorAll("[data-date]").forEach(button => button.addEventListener("click", () => { selectedDay = button.dataset.date; month = fromKey(selectedDay); render(); find(`[data-date="${selectedDay}"]`)?.focus({ preventScroll: true }); }));
    find("#calendar-agenda-title").textContent = fromKey(selectedDay).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "long" });
    const dayEvents = events.filter(event => event.date === selectedDay && active(event));
    find("#calendar-agenda").innerHTML = dayEvents.length ? dayEvents.map(event => `<article class="calendar-event" data-calendar-event="${esc(event.id)}"><div class="calendar-event-heading"><label class="calendar-select" title="${event.syncable ? "Select for Google sync" : "Confirm this task date before syncing"}"><input type="checkbox" data-select-event="${esc(event.id)}" aria-label="Select ${esc(event.title)} for Google sync" ${selected.has(event.id) ? "checked" : ""} ${event.syncable ? "" : "disabled"}><i class="calendar-dot ${esc(event.kind)}"></i></label><h3>${esc(event.title)}</h3></div><p class="calendar-event-meta">${esc(label[event.kind] || event.kind)} · ${esc(event.status === "active" ? dateLabel[event.dateState] || event.dateState : event.status)}</p>${event.details ? `<p class="calendar-event-notes">${esc(event.details)}</p>` : ""}<div class="calendar-event-actions">${event.source ? `<button type="button" class="calendar-source" data-source-event="${esc(event.id)}" ${typeof openRecord === "function" ? "" : "disabled"}>${event.source.kind === "task" ? "Open task" : "Open source"} <span aria-hidden="true">↗</span></button>` : ""}${event.editable ? `<button type="button" class="calendar-source" data-edit-event="${esc(event.id)}" ${access.canWrite ? "" : "disabled"}>Edit event</button>` : ""}</div></article>`).join("") : '<p class="calendar-empty">No events on this date.</p>';
    find("#calendar-agenda").querySelectorAll("[data-select-event]").forEach(input => input.addEventListener("change", () => { if (input.checked) selected.add(input.dataset.selectEvent); else selected.delete(input.dataset.selectEvent); renderSelection(); }));
    find("#calendar-agenda").querySelectorAll("[data-source-event]").forEach(button => button.addEventListener("click", () => { const event = events.find(e => e.id === button.dataset.sourceEvent); if (event?.source) void Promise.resolve(openRecord(event.source)).catch(error => notice(error.message, true)); }));
    find("#calendar-agenda").querySelectorAll("[data-edit-event]").forEach(button => button.addEventListener("click", () => edit(events.find(e => e.id === button.dataset.editEvent))));
    renderSelection();
  }
  function renderSelection() {
    if (!host) return;
    find("#calendar-selection").textContent = selected.size ? `${selected.size} selected. Their titles, dates and notes will be sent to your Google Calendar.` : "Select an event to send to Google.";
    find("#calendar-sync").disabled = !selected.size || !googleState.connected || googleBusy;
    find("#calendar-sync").textContent = googleBusy ? "Working…" : "Sync selected";
  }
  function edit(event) {
    if (draft) return notice("Save or discard your open event before starting another.");
    if (!access.canWrite || busy) return;
    setDraft(event ? { id: event.id, expectedRevision: event.revision, title: event.title, date: event.date, details: event.details, status: event.status } :
      { id: window.crypto.randomUUID(), expectedRevision: 0, title: "", date: selectedDay, details: "", status: "active" });
    renderEditor(); find("#calendar-event-title").focus(); find("#calendar-editor").scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }
  function renderEditor() {
    if (!host || !draft) return;
    const d = draft, editor = find("#calendar-editor"); editor.hidden = false;
    editor.innerHTML = `<form id="calendar-event-form"><div class="calendar-editor-heading"><h2>${d.expectedRevision ? "Edit event" : "New personal event"}</h2><span>All day · saved locally</span></div><fieldset ${busy || !access.canWrite ? "disabled" : ""}><div class="calendar-editor-fields"><label>Title<input id="calendar-event-title" name="title" required maxlength="160" value="${esc(d.title)}"></label><label>Date<input id="calendar-event-date" name="date" type="date" required value="${esc(d.date)}"></label></div><label>Notes <span class="calendar-optional">(optional)</span><textarea id="calendar-event-details" name="details" maxlength="3000" rows="3">${esc(d.details)}</textarea></label><div class="calendar-editor-actions"><button type="submit" class="btn primary">${busy ? "Saving…" : "Save event"}</button><button type="button" class="btn" id="calendar-discard">Discard draft</button>${d.expectedRevision ? `<button type="button" class="calendar-archive" id="calendar-archive">${d.status === "archived" ? "Restore event" : "Archive event"}</button>` : ""}</div></fieldset></form>`;
    const form = find("#calendar-event-form");
    form.addEventListener("input", () => { if (!busy && draft === d) for (const field of ["title", "date", "details"]) d[field] = form.elements.namedItem(field).value; });
    form.addEventListener("submit", event => { event.preventDefault(); void save(); });
    find("#calendar-discard").addEventListener("click", () => { if (window.confirm("Discard this unsaved calendar draft? Saved events remain.")) { setDraft(null); editor.hidden = true; notice(""); } });
    find("#calendar-archive")?.addEventListener("click", () => { const next = d.status === "archived" ? "active" : "archived"; if (next === "archived" && !window.confirm("Archive this local event? Its saved history remains. Any copy already sent to Google stays there.")) return; d.status = next; void save(); });
  }
  async function save() {
    if (!draft || busy) return; const turn = generation, editing = draft; busy = true; renderEditor(); notice("Saving locally…");
    try {
      const saved = await api("/api/calendar", { method: "POST", body: editing });
      if (draft === editing) setDraft(null);
      if (!host || turn !== generation) return;
      selectedDay = saved.date; month = fromKey(saved.date); find("#calendar-editor").hidden = true; await refresh(); notice(saved.status === "archived" ? "Event archived locally. Existing Google copies are unchanged." : "Event saved locally.");
      find("#calendar-agenda-title").setAttribute("tabindex", "-1"); find("#calendar-agenda-title").focus({ preventScroll: true }); find("#calendar-agenda-title").scrollIntoView?.({ block: "nearest" });
    } catch (error) { if (host && turn === generation) notice(error.message, true); }
    finally { busy = false; if (host) { find("#calendar-new").disabled = !access.canWrite; if (draft) renderEditor(); } }
  }
  async function open(id) {
    if (!host || !id) return;
    let event = events.find(item => item.id === id);
    if (!event) { await refresh(); event = events.find(item => item.id === id); }
    if (!event) return notice("That event is no longer available.", true);
    selectedDay = event.date; month = fromKey(event.date); if (event.status !== "active") { showInactive = true; find("#calendar-inactive").checked = true; } render();
  }
  async function refreshGoogle() {
    const turn = generation, wasPending = googleState.pending; let next;
    try { next = google?.status ? await google.status() : { available: false, connected: false, configured: false, message: "Connect Google Calendar from the desktop app." }; }
    catch (error) { next = { available: Boolean(google), connected: false, configured: false, message: error.message }; }
    if (host && turn === generation) {
      googleState = next || { available: false, connected: false, configured: false }; renderGoogle(); renderSelection();
      clearTimeout(googlePoll); googlePoll = null;
      if (googleState.pending) googlePoll = setTimeout(() => void refreshGoogle(), 1000);
      else if (wasPending && googleState.message) notice(googleState.message, !googleState.connected);
    }
  }
  function renderGoogle() {
    if (!host) return;
    const panel = find("#calendar-google"); panel.hidden = !googleOpen; find("#calendar-google-toggle").setAttribute("aria-expanded", String(googleOpen));
    const available = googleState.available !== false && Boolean(google), configured = googleState.configured === true, connected = googleState.connected === true, pending = googleState.pending === true;
    panel.innerHTML = `<div class="calendar-google-heading"><div><h3>Google Calendar</h3><p>${connected ? "Connected · selected events sync one way to your Case Forge calendar." : esc(googleState.message || (configured ? "Connect your account to sync selected events." : available ? "Google Calendar needs app connection settings before sign-in." : "Connect Google Calendar from the desktop app."))}</p></div><button type="button" class="btn small" id="calendar-google-close" aria-label="Close Google Calendar connection">${icon("close")}</button></div><p class="calendar-google-note">Only events you select are sent. Your case files and journal stay on this computer. Changes in Google are not imported.</p>${available ? `<button type="button" class="btn" id="calendar-google-connect" ${googleBusy || !configured ? "disabled" : ""}>${pending ? "Cancel sign-in" : connected ? "Disconnect Google" : "Connect Google"}</button>` : ""}${available && !configured && google?.configure ? '<details class="calendar-google-config"><summary>App connection settings</summary><p>A developer must supply a Google desktop OAuth client JSON for this app. Import that file to enable Google sign-in.</p><button type="button" class="btn" id="calendar-google-configure" '+(googleBusy?'disabled':'')+'>Import Google client</button></details>' : ""}`;
    find("#calendar-google-close").addEventListener("click", () => { googleOpen = false; renderGoogle(); find("#calendar-google-toggle").focus(); });
    find("#calendar-google-connect")?.addEventListener("click", () => void googleAction(connected || pending ? "disconnect" : "connect"));
    find("#calendar-google-configure")?.addEventListener("click", () => void googleAction("configure"));
  }
  async function googleAction(method, value) {
    if (googleBusy || !google?.[method]) return;
    const turn = generation; googleBusy = true; renderGoogle(); renderSelection();
    try { const result = await google[method](value); if (result?.error) throw new Error(result.error); if (!host || turn !== generation) return; await refreshGoogle(); notice(result?.message || (method === "disconnect" ? "Google disconnected. Existing Google events are unchanged." : method === "configure" ? googleState.configured ? "Connection settings saved." : "No connection file imported." : googleState.pending ? "Finish signing in in your browser." : googleState.connected ? "Google Calendar connected." : "Google Calendar is not connected.")); }
    catch (error) { if (host && turn === generation) notice(error.message, true); }
    finally { googleBusy = false; if (host) { renderGoogle(); renderSelection(); } }
  }
  async function sync() {
    if (googleBusy || !googleState.connected || !google?.sync || !selected.size) return;
    const chosen = events.filter(event => selected.has(event.id) && event.syncable).map(({ id, title, date, details }) => ({ id, title, date, details }));
    if (!chosen.length) return;
    const turn = generation; googleBusy = true; renderSelection();
    try {
      const result = await google.sync({ events: chosen }); if (result?.error) throw new Error(result.error); if (!host || turn !== generation) return;
      const failed = Array.isArray(result?.failed) ? result.failed : [];
      if (Array.isArray(result?.synced)) for (const id of result.synced) selected.delete(id);
      else if (!failed.length) selected.clear();
      const count = Array.isArray(result?.synced) ? result.synced.length : chosen.length - failed.length;
      notice(result?.message || `${count} ${count === 1 ? "event synced" : "events synced"} to Google Calendar.${failed.length ? ` ${failed.length} could not sync; they remain selected for retry.` : ""}`, failed.length > 0); render();
    }
    catch (error) { if (host && turn === generation) notice(error.message, true); }
    finally { googleBusy = false; if (host) renderSelection(); }
  }
  return { mount, unmount, open };
}
