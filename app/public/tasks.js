const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const STATUS = { todo: "To do", in_progress: "In progress", done: "Completed", cancelled: "Cancelled" };
const BUCKET = { review: "Needs review", overdue: "Overdue date", today: "Due today", upcoming: "Upcoming", undated: "No deadline", done: "Completed", cancelled: "Cancelled" };
const stamp = (value) => value ? new Date(value).toLocaleString() : "";
const dateLabel = (c) => c.deadlineStatus === "none" ? "No deadline recorded" : `${c.dueDate} · ${c.effectiveDeadlineStatus === "review_required" ? "confirmation needs review" : c.deadlineStatus === "confirmed" ? "user-confirmed" : "proposed, not confirmed"} · ${c.timeZone}`;
const CONTENT_FIELDS = ["title", "kind", "assignee", "details", "status", "completionNote", "sourceId", "sourceLocator", "dueDate", "deadlineStatus", "dateOrigin", "deadlineBasis", "timeZone", "reminderDate"];

export function createTasks({ api, getSession }) {
  let host = null, generation = 0, refreshId = 0, caseKey = null, draft = null, selected = null, targets = [], journalChoices = [], entries = [], busy = false, timer = null, filter = "open";
  const find = (s) => host?.querySelector(s);
  const unload = (e) => { if (draft) { e.preventDefault(); e.returnValue = ""; } };
  function setDraft(value) { draft = value; window.removeEventListener("beforeunload", unload); if (draft) window.addEventListener("beforeunload", unload); }
  function notice(message, error = false) { const node = find("#tasks-message"); if (node) { node.textContent = message; node.classList.toggle("error", error); } }
  function unmount() { generation++; refreshId++; if (timer) clearInterval(timer); timer = null; host = null; }
  async function mount(element) {
    unmount(); host = element;
    if (caseKey !== getSession().caseKey) { setDraft(null); selected = null; targets = []; journalChoices = []; filter = "open"; }
    caseKey = getSession().caseKey;
    host.innerHTML = `<div class="inbox-heading"><div><p class="eyebrow">Tasks, obligations and deadlines</p><h2>Know what needs doing next.</h2><p>Record the action, who is responsible and the source behind it.</p></div><button type="button" class="btn primary" id="tasks-new">New task</button></div>
      <p class="workflow-warning">Confirm dates after reviewing them. This calendar-date tracker does not calculate court deadlines or cut-off times. Check any required time separately.</p>
      <p class="inbox-access" id="tasks-access"></p><div class="task-counts" id="tasks-counts" aria-label="Task counts"></div>
      <p class="inbox-message" id="tasks-message" role="status" aria-live="polite"></p>
      <div class="inbox-layout"><section class="card inbox-list" aria-label="Tasks"><div class="hd task-list-heading"><h2>Your tasks</h2><button type="button" class="btn small" id="tasks-refresh">Refresh</button><label for="tasks-filter">Show</label><select id="tasks-filter">${[["open", "Open tasks"], ["all", "All tasks"], ["review", "Needs review"], ["overdue", "Overdue dates"], ["today", "Due today"], ["upcoming", "Upcoming"], ["reminders", "Reminder due"], ["done", "Completed"], ["cancelled", "Cancelled"]].map(([v, l]) => `<option value="${v}" ${filter === v ? "selected" : ""}>${l}</option>`).join("")}</select></div><div id="tasks-list"><p class="empty">Loading tasks…</p></div></section>
      <section class="card" id="tasks-detail" aria-label="Task details"><div class="welcome-panel"><h3>One clear next action.</h3><p>Start with a personal task or a reviewed obligation from a case note or document. Nothing is sent to AI.</p></div></section></div>`;
    find("#tasks-new").addEventListener("click", () => {
      if (draft) return notice("Your draft is still open. Save or discard it before starting another task.");
      if (busy || !getSession().access.canWrite) return;
      selected = null;
      setDraft({ id: window.crypto.randomUUID(), requestId: window.crypto.randomUUID(), expectedRevision: 0, actor: "", reason: "", reviewObligation: false, confirmDeadline: false,
        content: { title: "", kind: "task", assignee: "", details: "", status: "todo", completionNote: "", sourceId: "", sourceDigest: "", sourceLocator: "", dueDate: "", deadlineStatus: "none", dateOrigin: "personal", deadlineBasis: "", timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", reminderDate: "" } });
      renderForm();
    });
    find("#tasks-refresh").addEventListener("click", () => void refresh());
    find("#tasks-filter").addEventListener("change", (e) => { filter = e.target.value; renderList(); });
    if (draft) renderForm();
    await refresh();
    if (host === element) timer = setInterval(() => { if (!draft && !busy && !document.hidden) void refresh(); }, 60_000);
  }
  async function refresh() {
    const turn = generation, request = ++refreshId;
    try {
      const [result, choices] = await Promise.all([api("/api/tasks"), api("/api/tasks/targets")]);
      if (!host || generation !== turn || request !== refreshId) return;
      const retained = targets.filter((t) => draft?.content.sourceId === t.id && !choices.targets.some((v) => v.id === t.id));
      targets = [...choices.targets, ...retained]; entries = result.entries;
      const refreshedSource = targets.find((t) => t.id === draft?.content.sourceId);
      if (draft && refreshedSource && refreshedSource.digest !== draft.content.sourceDigest) {
        draft.content.sourceDigest = refreshedSource.digest; draft.confirmDeadline = false; draft.reviewObligation = false; draft.requestId = window.crypto.randomUUID();
        notice("The source reference was refreshed. Review it and confirm the obligation or deadline again before saving.");
      }
      find("#tasks-access").textContent = `${result.access.canWrite ? "Writable local preview" : "Read-only workspace"} · reminders appear here while the app is open; no email or device notifications`;
      find("#tasks-new").disabled = !result.access.canWrite || busy;
      find("#tasks-counts").innerHTML = [["review", "Needs review"], ["overdue", "Overdue dates"], ["today", "Due today"], ["reminders", "Reminder due"]].map(([k, label]) => `<button type="button" class="task-count" data-filter="${k}"><strong>${result.counts[k]}</strong><span>${label}</span></button>`).join("");
      find("#tasks-counts").querySelectorAll("[data-filter]").forEach((b) => b.addEventListener("click", () => { filter = b.dataset.filter; find("#tasks-filter").value = filter; renderList(); }));
      renderList();
      if (draft) renderForm(); else if (selected) await open(selected);
    } catch (error) { if (host && generation === turn && request === refreshId) notice(error.message, true); }
  }
  function renderList() {
    if (!host) return;
    const visible = entries.filter((e) => filter === "all" || (filter === "open" ? !["done", "cancelled"].includes(e.bucket) : filter === "reminders" ? e.reminderDue : e.bucket === filter));
    find("#tasks-list").innerHTML = visible.length ? visible.map((e) => `<button type="button" class="document-item ${selected === e.id ? "selected" : ""}" aria-pressed="${selected === e.id}" data-task="${esc(e.id)}"><span><strong>${esc(e.title)}</strong><small>${esc(e.assignee)} · ${esc(STATUS[e.status])}</small><small>${esc(dateLabel(e))}</small><span class="task-badge ${esc(e.bucket)}">${esc(BUCKET[e.bucket])}</span>${e.reminderDue ? '<span class="task-badge">Reminder due</span>' : ""}</span></button>`).join("") : `<p class="empty">${entries.length ? "No tasks match this view." : "No tasks yet. Add a clear action to get started."}</p>`;
    find("#tasks-list").querySelectorAll("[data-task]").forEach((b) => b.addEventListener("click", () => {
      if (draft) return notice("Your draft is still open. Save or discard it before opening another task.");
      void open(b.dataset.task);
    }));
  }
  async function open(id) {
    selected = id; const turn = generation;
    try { const e = await api(`/api/tasks/${id}`); if (host && generation === turn && selected === id && !draft) { renderEntry(e); renderList(); } }
    catch (error) { if (host && generation === turn && selected === id) notice(error.message, true); }
  }
  function contentView(c) {
    return `<p><b>${esc(c.kind === "obligation" ? "Recorded obligation" : "Task")}</b> · ${esc(STATUS[c.status])}</p><p>Responsible: <b>${esc(c.assignee)}</b></p>
      ${c.details ? `<h3>What needs doing</h3><p class="journal-text">${esc(c.details)}</p>` : ""}
      <h3>Deadline</h3><p>${esc(dateLabel(c))}</p>${c.deadlineBasis ? `<p class="journal-text">${esc(c.deadlineBasis)}</p>` : ""}<p class="journal-meta">Date origin: ${esc({ personal: "personal planning", source: "source document or case note", suggested: "suggested date" }[c.dateOrigin])}. No cut-off time is assumed.</p>
      ${c.confirmedAt ? `<p class="journal-meta">Confirmed by ${esc(c.confirmedBy)} · ${esc(stamp(c.confirmedAt))}</p>` : ""}${c.reminderDate ? `<p>In-app reminder from ${esc(c.reminderDate)} (${esc(c.timeZone)})</p>` : ""}
      ${c.source ? `<h3>Source reference</h3><p class="journal-text">${esc(c.source.title)}${c.source.locator ? ` · ${esc(c.source.locator)}` : ""}</p><p class="journal-meta">${esc(c.source.id)}</p>${c.source.kind === "journal" ? '<p class="journal-meta">Journal reference only. No account text or reflection has been copied.</p>' : ""}` : ""}
      ${c.reviewedAt ? `<p class="journal-meta">Obligation reviewed by ${esc(c.reviewedBy)} · ${esc(stamp(c.reviewedAt))}</p>` : ""}
      ${c.completedAt ? `<h3>Completion record</h3><p class="journal-text">${esc(c.completionNote)}</p><p class="journal-meta">Marked complete ${esc(stamp(c.completedAt))}; this records your update, not independent proof of compliance.</p>` : ""}`;
  }
  function renderEntry(entry) {
    const latest = entry.revisions.at(-1);
    find("#tasks-detail").innerHTML = `<div class="detail-header"><p class="eyebrow">${esc(BUCKET[entry.bucket])}</p><h2>${esc(latest.content.title)}</h2><p>Version ${latest.revision} · updated ${esc(stamp(latest.savedAt))}</p></div><div class="detail-body">
      ${["changed", "missing"].includes(entry.sourceState) ? `<p class="workflow-warning">The linked source is ${esc(entry.sourceState)}. Review it again. Active tasks with changed or missing sources are excluded from confirmed deadline and reminder queues.</p>` : ""}
      ${contentView({ ...latest.content, effectiveDeadlineStatus: entry.effectiveDeadlineStatus })}<button type="button" class="btn" id="tasks-edit" ${getSession().access.canWrite && !busy ? "" : "disabled"}>Update task</button>
      <details class="journal-history"><summary>Change history (${entry.revisions.length})</summary><p class="journal-meta">Names are entered by the user, not authenticated signatures. Times come from this computer.</p>${[...entry.revisions].reverse().map((r) => `<details><summary>Version ${r.revision} · ${esc(stamp(r.savedAt))}</summary><h3>${esc(r.content.title)}</h3><p class="journal-text">${esc(r.actor)}: ${esc(r.reason || "Created task")}</p>${contentView(r.content)}</details>`).join("")}</details></div>`;
    find("#tasks-edit").addEventListener("click", () => {
      const c = latest.content;
      const fields = Object.fromEntries(CONTENT_FIELDS.map((k) => [k, k === "sourceId" ? c.source?.id || "" : k === "sourceLocator" ? c.source?.locator || "" : c[k]]));
      fields.sourceDigest = c.source?.digest || "";
      if (c.source && !targets.some((t) => t.id === c.source.id)) targets.push({ ...c.source });
      setDraft({ id: entry.id, requestId: window.crypto.randomUUID(), expectedRevision: latest.revision, actor: latest.actor, reason: "", confirmDeadline: false, reviewObligation: false, content: fields });
      renderForm();
    });
  }
  function renderForm() {
    if (!host || !draft) return;
    const d = draft, c = d.content;
    const input = (name, label, max, required = false, type = "text") => `<label for="task-${name}">${label}</label><input id="task-${name}" name="${name}" type="${type}" maxlength="${max}" ${required ? "required" : ""} value="${esc(c[name])}">`;
    const area = (name, label, max) => `<label for="task-${name}">${label}</label><textarea id="task-${name}" name="${name}" maxlength="${max}" rows="3">${esc(c[name])}</textarea>`;
    const select = (name, label, options) => `<label for="task-${name}">${label}</label><select id="task-${name}" name="${name}">${options.map(([v, l]) => `<option value="${v}" ${c[name] === v ? "selected" : ""}>${l}</option>`).join("")}</select>`;
    const allTargets = [...targets, ...journalChoices.filter((t) => !targets.some((v) => v.id === t.id))];
    find("#tasks-detail").innerHTML = `<form id="tasks-form" class="detail-body journal-form"><h2>${d.expectedRevision ? "Update task" : "New task"}</h2><p class="journal-meta">Save deliberately. Your draft stays in this tab while you visit other views. Updates preserve earlier versions.</p><fieldset ${busy || !getSession().access.canWrite ? "disabled" : ""}>
      ${input("title", "What needs doing?", 160, true)}${select("kind", "Type", [["task", "Personal task"], ["obligation", "Source-linked obligation"]])}${input("assignee", "Who is responsible?", 160, true)}${area("details", "Details / obligation as you understand it", 3000)}
      <label for="task-sourceId">Supporting record (optional for a personal task)</label><select id="task-sourceId" name="sourceId"><option value="">No linked source</option>${allTargets.map((t) => `<option value="${esc(t.id)}" ${c.sourceId === t.id ? "selected" : ""}>${esc(t.kind)}: ${esc(t.title)}</option>`).join("")}</select>
      <button type="button" class="btn small" id="tasks-journal-choices">Include journal references</button><p class="journal-meta">Choosing this loads journal titles only. A journal account alone cannot establish an obligation.</p>
      ${input("sourceLocator", "Source location, such as page 2, paragraph 4", 500)}
      <label class="journal-choice"><input type="checkbox" name="reviewObligation" ${d.reviewObligation ? "checked" : ""}><span>I reviewed this obligation against the linked source. Required for a new or changed obligation.</span></label>
      <h3>Date and review</h3>${select("deadlineStatus", "Deadline status", [["none", "No date"], ["proposed", "Proposed — needs review"], ["confirmed", "Confirmed by me"]])}
      <div class="journal-fields"><div>${input("dueDate", "Due date (no time assumed)", 10, false, "date")}</div><div>${input("timeZone", "Deadline time zone", 80, true)}</div></div>
      ${select("dateOrigin", "Where did the date come from?", [["personal", "My planning date"], ["source", "A document or case note"], ["suggested", "A suggestion I need to check"]])}
      ${area("deadlineBasis", "How you checked the date / cut-off time to check separately", 1000)}
      <label class="journal-choice"><input type="checkbox" name="confirmDeadline" ${d.confirmDeadline ? "checked" : ""}><span>I reviewed and confirm this date and its basis. Required for a new or changed confirmed deadline.</span></label>
      ${input("reminderDate", "In-app reminder date (confirmed deadlines only)", 10, false, "date")}<p class="journal-meta">Appears in this task view from that day until completion or cancellation. No email, calendar or device notification is sent.</p>
      ${select("status", "Progress", Object.entries(STATUS))}${area("completionNote", "Completion note (required only when completed)", 2000)}
      <label for="task-actor">Your name for this update</label><input id="task-actor" name="actor" maxlength="160" required value="${esc(d.actor)}">
      <label for="task-reason">Change note${d.expectedRevision ? " (required)" : " (optional unless cancelling)"}</label><textarea id="task-reason" name="reason" maxlength="500" rows="2" ${d.expectedRevision ? "required" : ""}>${esc(d.reason)}</textarea>
      <div class="journal-actions"><button class="btn primary" type="submit">${busy ? "Saving…" : "Save task"}</button><button type="button" class="btn" id="tasks-discard">Discard draft</button>${d.expectedRevision ? '<button type="button" class="btn" id="tasks-latest">Read latest saved version</button>' : ""}</div></fieldset><div class="task-latest-copy" id="tasks-latest-copy"></div></form>`;
    const form = find("#tasks-form");
    form.addEventListener("input", (event) => {
      if (busy || draft !== d) return;
      for (const k of CONTENT_FIELDS) c[k] = form.elements.namedItem(k).value;
      for (const k of ["actor", "reason"]) d[k] = form.elements.namedItem(k).value;
      for (const k of ["reviewObligation", "confirmDeadline"]) d[k] = form.elements.namedItem(k).checked;
      d.requestId = window.crypto.randomUUID();
      if (!["reviewObligation", "confirmDeadline", "actor", "reason", "status", "completionNote", "reminderDate"].includes(event.target.name)) {
        d.reviewObligation = false; d.confirmDeadline = false;
        form.elements.namedItem("reviewObligation").checked = false; form.elements.namedItem("confirmDeadline").checked = false;
      }
      if (event.target.name === "dueDate") {
        c.deadlineStatus = c.dueDate ? "proposed" : "none"; c.reminderDate = "";
        form.elements.namedItem("deadlineStatus").value = c.deadlineStatus; form.elements.namedItem("reminderDate").value = "";
      }
      if (event.target.name === "sourceId") c.sourceDigest = allTargets.find((t) => t.id === c.sourceId)?.digest || "";
    });
    form.addEventListener("submit", (e) => { e.preventDefault(); void save(); });
    find("#tasks-discard").addEventListener("click", () => {
      if (!window.confirm("Discard this unsaved task draft? Saved tasks and their history remain.")) return;
      setDraft(null); notice("");
      if (selected) void open(selected); else find("#tasks-detail").innerHTML = '<p class="empty">Draft discarded. Choose a task or start another.</p>';
    });
    find("#tasks-journal-choices").addEventListener("click", async () => {
      const turn = generation;
      try {
        const result = await api("/api/tasks/journal-targets");
        if (!host || turn !== generation || draft !== d) return;
        journalChoices = result.targets;
        targets = targets.filter((t) => t.kind !== "journal" || !journalChoices.some((j) => j.id === t.id));
        const source = journalChoices.find((t) => t.id === d.content.sourceId);
        if (source && source.digest !== d.content.sourceDigest) {
          d.content.sourceDigest = source.digest; d.confirmDeadline = false; d.reviewObligation = false; d.requestId = window.crypto.randomUUID();
        }
        renderForm(); notice(journalChoices.length ? "Journal references refreshed; review any selected entry before confirming its date. No journal text was copied." : "There are no saved journal entries to link yet.");
      } catch (error) { if (host && turn === generation) notice(error.message, true); }
    });
    find("#tasks-latest")?.addEventListener("click", async () => {
      const turn = generation;
      try {
        const entry = await api(`/api/tasks/${d.id}`);
        if (!host || turn !== generation || draft !== d) return;
        const latest = entry.revisions.at(-1);
        find("#tasks-latest-copy").innerHTML = `<h3>Latest saved version ${latest.revision}: ${esc(latest.content.title)}</h3><p class="journal-meta">Your draft above is unchanged. Copy any text you need, discard the draft, then reopen the task to edit the latest version.</p>${contentView(latest.content)}`;
      } catch (error) { if (host && turn === generation) notice(error.message, true); }
    });
  }
  async function save() {
    if (!draft || busy) return;
    const editing = draft, turn = generation;
    busy = true; renderForm(); notice("Saving task locally…");
    try {
      const entry = await api("/api/tasks", { method: "POST", body: editing });
      if (draft === editing) { setDraft(null); selected = entry.id; }
      if (host && generation === turn) { busy = false; await refresh(); notice("Task saved locally. No AI request or notification was sent."); }
    } catch (error) { if (host && generation === turn) notice(error.message, true); }
    finally {
      busy = false;
      if (host) { find("#tasks-new").disabled = !getSession().access.canWrite; if (draft) renderForm(); else if (generation !== turn && selected) void refresh(); }
    }
  }
  return { mount, unmount };
}
