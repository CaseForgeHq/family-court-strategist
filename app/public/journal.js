const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const stamp = (value) => new Date(value).toLocaleString();
const timing = (c) => c.precision === "unknown" ? "Event timing unknown" : `${c.occurredDate}${c.occurredTime ? ` at ${c.occurredTime}` : " · time not recorded"} (${c.timeZone}; ${c.precision})`;

export function createJournal({ api, getSession }) {
  let host = null, generation = 0, draft = null, draftCase = null, targets = [], busy = false, selected = null;
  const find = (selector) => host?.querySelector(selector);
  function notice(message, error = false) {
    const node = find("#journal-message");
    if (node) { node.textContent = message; node.classList.toggle("error", error); }
  }
  const unload = (event) => { if (draft) { event.preventDefault(); event.returnValue = ""; } };
  function setDraft(value) {
    draft = value;
    window.removeEventListener("beforeunload", unload);
    if (draft) window.addEventListener("beforeunload", unload);
  }
  function unmount() { generation++; host = null; }
  async function mount(element) {
    unmount(); host = element;
    if (draftCase !== getSession().caseKey) { setDraft(null); selected = null; }
    draftCase = getSession().caseKey;
    host.innerHTML = `<div class="inbox-heading"><div><p class="eyebrow">Case journal · parenting log</p><h2>A place to record your experience.</h2><p>Keep what happened, remembered words and personal reflections distinct.</p></div><button class="btn primary" id="journal-new" type="button">New entry</button></div>
      <p class="workflow-warning">Personal accounts, not verified facts. Entries stay out of AI analysis and chronology exports. Linking a record does not verify your account.</p>
      <details class="journal-privacy"><summary>How your journal is kept</summary><p>Saved locally in this case folder. Reflections are hidden until you open them. Local storage is not encrypted and does not imply legal privilege. Back up the whole case folder, including hidden files. Nothing is sent to AI by this journal.</p></details>
      <p id="journal-access" class="inbox-access"></p><p id="journal-message" class="inbox-message" role="status" aria-live="polite"></p>
      <div class="inbox-layout"><section class="card inbox-list" aria-label="Journal entries"><div class="hd"><h2>Entries</h2><button type="button" class="btn small" id="journal-refresh">Refresh</button></div><div id="journal-list"><p class="empty">Loading entries…</p></div></section>
      <section class="card" id="journal-detail" aria-label="Journal entry"><div class="welcome-panel"><h3>Start with what you remember.</h3><p>An entry can be a daily log, a specific incident or simply a personal reflection.</p></div></section></div>`;
    find("#journal-new").addEventListener("click", () => {
      if (draft) return notice("Your unsaved entry is open. Save it or discard it before starting another.");
      if (busy || !getSession().access.canWrite) return;
      selected = null;
      setDraft({ id: window.crypto.randomUUID(), expectedRevision: 0, reason: "", content: {
        title: "", happened: "", words: "", reflection: "", occurredDate: "", occurredTime: "",
        precision: "unknown", timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", links: [],
      } });
      renderForm();
    });
    find("#journal-refresh").addEventListener("click", () => void refresh());
    if (draft) renderForm();
    await refresh();
  }
  async function refresh() {
    const turn = generation;
    try {
      const [result, linked] = await Promise.all([api("/api/journal"), api("/api/journal/targets")]);
      if (!host || turn !== generation) return;
      targets = [...linked.targets, ...targets.filter((old) => draft?.content.links.includes(old.id) && !linked.targets.some((t) => t.id === old.id))];
      find("#journal-access").textContent = result.access.canWrite ? "Writable local preview · save entries explicitly" : "Read-only workspace · existing entries are available to read";
      find("#journal-new").disabled = !result.access.canWrite || busy;
      find("#journal-list").innerHTML = result.entries.length ? result.entries.map((e) => `<button type="button" class="document-item" data-entry="${esc(e.id)}"><span><strong>${esc(e.title)}</strong><small>${esc(timing(e))}</small><small>Recorded ${esc(stamp(e.recordedAt))} · version ${e.revision}</small></span></button>`).join("") : '<p class="empty">No journal entries yet. Your first account can be as short as a few sentences.</p>';
      find("#journal-list").querySelectorAll("[data-entry]").forEach((button) => button.addEventListener("click", () => {
        if (draft) return notice("Your draft is still open. Save it or discard it before opening another entry.");
        void open(button.dataset.entry);
      }));
      if (draft) renderForm();
      else if (selected) await open(selected);
    } catch (error) { if (host && turn === generation) notice(error.message, true); }
  }
  async function open(id) {
    selected = id;
    const turn = generation;
    try {
      const entry = await api(`/api/journal/${id}`);
      if (!host || turn !== generation || selected !== id || draft) return;
      renderEntry(entry);
      notice("");
    } catch (error) { if (host && turn === generation) notice(error.message, true); }
  }
  function account(r) {
    const c = r.content;
    return `<p class="journal-meta">${esc(timing(c))}</p>
      ${c.happened ? `<h3>What happened · your account</h3><p class="journal-text">${esc(c.happened)}</p>` : ""}
      ${c.words ? `<h3>Remembered words · your recollection</h3><p class="journal-text">${esc(c.words)}</p>` : ""}
      ${c.reflection ? `<details class="journal-reflection"><summary>Personal reflection · open to read</summary><p class="journal-text">${esc(c.reflection)}</p></details>` : ""}
      ${c.links.length ? `<h3>Linked records</h3><ul class="journal-links">${c.links.map((l) => `<li>${esc(l.kind)}: ${esc(l.title)}${l.available === false ? " · no longer available" : ""}<small>${esc(l.id)}</small></li>`).join("")}</ul><p class="journal-meta">Connections for context; supporting evidence has not been verified.</p>` : ""}`;
  }
  function renderEntry(entry) {
    const latest = entry.revisions.at(-1);
    find("#journal-detail").innerHTML = `<div class="detail-header"><p class="eyebrow">Personal account · unverified</p><h2>${esc(latest.content.title)}</h2><p>First recorded ${esc(stamp(entry.recordedAt))}</p><p>Version ${latest.revision} · saved ${esc(stamp(latest.savedAt))}</p></div>
      <div class="detail-body">${account(latest)}<button class="btn" id="journal-edit" type="button" ${getSession().access.canWrite && !busy ? "" : "disabled"}>Add a correction</button>
      <details class="journal-history"><summary>Version history (${entry.revisions.length})</summary><p class="journal-meta">Recording times come from this computer. This history is not a certified or tamper-proof record.</p>${[...entry.revisions].reverse().map((r) => `<details><summary>Version ${r.revision} · ${esc(stamp(r.savedAt))}</summary><h3>${esc(r.content.title)}</h3><p class="journal-text">${esc(r.reason || "Original entry")}</p>${account(r)}</details>`).join("")}</details></div>`;
    find("#journal-edit").addEventListener("click", () => {
      setDraft({ id: entry.id, expectedRevision: latest.revision, reason: "", content: { ...latest.content, links: latest.content.links.map((l) => l.id) } });
      // Preserve missing links for display and deliberate removal during edits.
      targets = [...targets, ...latest.content.links.filter((l) => !targets.some((t) => t.id === l.id)).map((l) => ({ ...l, title: `${l.title} · no longer available` }))];
      renderForm();
    });
  }
  function renderForm() {
    if (!host || !draft) return;
    const c = draft.content;
    const field = (name, label, max, hint = "") => `<label for="journal-${name}">${label}</label>${hint ? `<p class="journal-meta" id="journal-${name}-help">${hint}</p>` : ""}<textarea id="journal-${name}" name="${name}" rows="4" maxlength="${max}" ${hint ? `aria-describedby="journal-${name}-help"` : ""}>${esc(c[name])}</textarea>`;
    find("#journal-detail").innerHTML = `<form id="journal-form" class="detail-body journal-form"><h2>${draft.expectedRevision ? "Correct your entry" : "New journal entry"}</h2><p class="journal-meta">${draft.expectedRevision ? `Editing version ${draft.expectedRevision}. Saving keeps the earlier account.` : "The recording time is added when you save. Event timing can remain unknown."} Your draft stays in this tab while you visit other views.</p>
      <fieldset ${busy || !getSession().access.canWrite ? "disabled" : ""}>
      <label for="journal-title">Entry title</label><input id="journal-title" name="title" maxlength="160" required value="${esc(c.title)}" placeholder="For example, afternoon handover">
      <div class="journal-fields"><div><label for="journal-occurredDate">Event date, if known</label><input type="date" id="journal-occurredDate" name="occurredDate" value="${esc(c.occurredDate)}"></div><div><label for="journal-occurredTime">Event time, if known</label><input type="time" id="journal-occurredTime" name="occurredTime" value="${esc(c.occurredTime)}"></div></div>
      <div class="journal-fields"><div><label for="journal-precision">Timing certainty</label><select id="journal-precision" name="precision">${[["unknown", "Unknown"], ["approximate", "Approximate"], ["exact", "Exact as recalled"]].map(([v, label]) => `<option value="${v}" ${c.precision === v ? "selected" : ""}>${label}</option>`).join("")}</select></div><div><label for="journal-timeZone">Event time zone</label><input id="journal-timeZone" name="timeZone" maxlength="80" required value="${esc(c.timeZone)}"></div></div>
      ${field("happened", "What happened", 4000, "Describe what you personally observed. Attribute information you learned from someone else.")}
      ${field("words", "Remembered words", 3000, "Include who said it and the context. Say when wording is approximate; a recollection is not a verified quotation.")}
      <details class="journal-reflection" ${c.reflection ? "open" : ""}><summary>Personal reflection (optional)</summary>${field("reflection", "How you felt or what you want to reflect on", 3000, "This stays in your journal, outside current AI analysis and chronology exports.")}</details>
      <details class="journal-links"><summary>Link existing case records (${c.links.length} selected)</summary><p class="journal-meta">Choose up to 20. A link provides context; it does not establish truth.</p><div class="journal-targets">${targets.length ? targets.map((t) => `<label class="journal-choice"><input type="checkbox" name="links" value="${esc(t.id)}" ${c.links.includes(t.id) ? "checked" : ""}><span>${esc(t.kind)}: ${esc(t.title)}<small>${esc(t.id)}</small></span></label>`).join("") : '<p class="journal-meta">No existing case records to link yet.</p>'}</div></details>
      ${draft.expectedRevision ? '<label for="journal-reason">Why are you correcting this entry?</label><textarea id="journal-reason" name="reason" rows="2" maxlength="500" required>' + esc(draft.reason) + '</textarea>' : ""}
      <div class="journal-actions"><button class="btn primary" type="submit">${busy ? "Saving…" : draft.expectedRevision ? "Save correction" : "Save entry"}</button><button class="btn" id="journal-discard" type="button">Discard draft</button>${draft.expectedRevision ? '<button class="btn" id="journal-latest" type="button">Read latest saved version</button>' : ""}</div></fieldset><div id="journal-latest-copy"></div></form>`;
    const form = find("#journal-form");
    form.addEventListener("input", () => {
      if (busy) return;
      for (const key of Object.keys(c)) {
        if (key !== "links") c[key] = form.elements.namedItem(key).value;
      }
      c.links = [...form.querySelectorAll('[name="links"]:checked')].map((e) => e.value);
      draft.reason = form.elements.namedItem("reason")?.value || "";
    });
    form.addEventListener("submit", (e) => { e.preventDefault(); void save(); });
    find("#journal-discard").addEventListener("click", () => {
      if (!window.confirm("Discard this unsaved draft? Saved journal entries and their history will remain.")) return;
      setDraft(null); notice("");
      if (selected) void open(selected);
      else find("#journal-detail").innerHTML = '<p class="empty">Draft discarded. Choose an entry or start a new one.</p>';
    });
    find("#journal-latest")?.addEventListener("click", async () => {
      const turn = generation, editing = draft;
      try {
        const saved = await api(`/api/journal/${editing.id}`);
        if (!host || turn !== generation || draft !== editing) return;
        const latest = saved.revisions.at(-1);
        find("#journal-latest-copy").innerHTML = `<h3>Latest saved version ${latest.revision}</h3><p class="journal-meta">Your draft above has not changed. To edit this version, copy any text you want to keep, discard the draft, then reopen the entry.</p><h3>${esc(latest.content.title)}</h3>${account(latest)}`;
      } catch (error) { if (host && turn === generation) notice(error.message, true); }
    });
  }
  async function save() {
    if (!draft || busy) return;
    const editing = draft, turn = generation;
    busy = true; renderForm(); notice("Saving locally…");
    try {
      const entry = await api("/api/journal", { method: "POST", body: editing });
      if (draft === editing) { setDraft(null); selected = entry.id; }
      if (host && generation === turn) {
        busy = false;
        await refresh();
        notice("Saved locally. Your account has not been added to verified facts or sent to AI.");
      }
    } catch (error) { if (host && generation === turn) notice(error.message, true); }
    finally {
      busy = false;
      if (host) {
        find("#journal-new").disabled = !getSession().access.canWrite;
        if (draft) renderForm();
        else if (generation !== turn && selected) void open(selected);
      }
    }
  }
  return { mount, unmount };
}
