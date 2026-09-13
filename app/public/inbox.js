const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const STATUS = { queued_read: "Waiting to read", reading: "Reading", ready: "Ready to analyse", queued: "Analysis queued", analysing: "Analysing", review: "Ready for review", saved: "Saved to case", failed: "Needs attention", cancelled: "Cancelled", interrupted: "Interrupted", needs_ocr: "Needs text recognition" };
const BUSY = ["queued_read", "reading", "queued", "analysing"];
const LABEL = { "claude-code": "Claude · existing sign-in", anthropic: "Claude · API key", ollama: "Ollama · local model" };
const KIND = { event: "Timeline event", claim: "Attributed claim", inconsistency: "Possible inconsistency", follow_up: "Follow-up" };

export function createInbox({ api, getSession, updateSession, showModal, closeModal, onSaved }) {
  let host = null, selected = null, documents = [], signature = "", timer = null, generation = 0;
  let refreshing = false;

  function notice(message, error = false) {
    const element = host?.querySelector("#inbox-message");
    if (element) { element.textContent = message; element.classList.toggle("error", error); }
  }

  function mount(element) {
    unmount(); host = element;
    host.innerHTML = `
      <div class="inbox-heading"><div><p class="eyebrow">Your document inbox</p><h2>Build your case, one document at a time.</h2>
      <p>Add a document, review what your AI finds, then choose what to save.</p></div>
      <button class="btn" id="inbox-connect" type="button">Connect AI</button></div>
      <div class="inbox-access" id="inbox-access"></div>
      <label class="dropzone" id="document-drop" tabindex="0" role="button" aria-label="Add PDF or text documents">
        <span class="drop-icon" aria-hidden="true">＋</span><strong>Add documents</strong>
        <span>Drop files here or click to browse · PDF, TXT or Markdown · up to 20 MB each</span>
        <small>Originals stay in your case folder. Adding a file does not send it to AI. Scanned PDFs need a text layer.</small>
        <input id="document-picker" type="file" accept=".pdf,.txt,.md" multiple hidden>
      </label>
      <p id="inbox-message" class="inbox-message" role="status" aria-live="polite"></p>
      <div class="inbox-layout"><section class="card inbox-list" aria-label="Imported documents"><div class="hd"><h2>Documents</h2><span id="document-count">0</span></div><div id="document-list"></div></section>
      <section class="card inbox-detail" id="document-detail" aria-label="Document details"><div class="welcome-panel"><h3>Your originals. Your findings. Your case.</h3><p>Add a document to get started. You choose when analysis runs and which findings become case notes.</p></div></section></div>`;
    host.querySelector("#inbox-connect").addEventListener("click", connectionModal);
    host.querySelector("#document-picker").addEventListener("change", (event) => { void upload(event.target.files); event.target.value = ""; });
    const drop = host.querySelector("#document-drop");
    drop.addEventListener("keydown", (event) => { if (["Enter", " "].includes(event.key) && event.target === drop) { event.preventDefault(); host.querySelector("#document-picker").click(); } });
    drop.addEventListener("dragover", (event) => { event.preventDefault(); drop.classList.add("dragging"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("dragging"));
    drop.addEventListener("drop", (event) => { event.preventDefault(); drop.classList.remove("dragging"); void upload(event.dataTransfer.files); });
    host.addEventListener("click", handleClick);
    void refresh();
    timer = setInterval(() => { if (!document.hidden) void refresh(); }, 2000);
  }

  function unmount() {
    generation++;
    if (timer) clearInterval(timer);
    host?.removeEventListener("click", handleClick);
    host = null; signature = ""; refreshing = false;
  }

  async function refresh(force = false) {
    if (!host || refreshing) return;
    refreshing = true;
    const revision = generation;
    try {
      const result = await api("/api/documents");
      if (!host || generation !== revision) return;
      documents = result.documents;
      const session = getSession();
      updateSession({ ...session, access: result.access });
      host.querySelector("#inbox-access").textContent = `${result.access.message}. ${session.connection ? `${LABEL[session.connection.provider]} connected.` : "No AI connected yet."}`;
      host.querySelector("#document-picker").disabled = !result.access.canWrite;
      host.querySelector("#document-drop").setAttribute("aria-disabled", String(!result.access.canWrite));
      host.querySelector("#inbox-connect").textContent = session.connection ? "AI connection" : "Connect AI";
      host.querySelector("#document-count").textContent = documents.length;
      if (!selected || !documents.some((d) => d.id === selected)) selected = documents[0]?.id || null;
      host.querySelector("#document-list").innerHTML = documents.length ? documents.map((d) => `
        <button type="button" class="document-item ${selected === d.id ? "selected" : ""}" data-document="${esc(d.id)}" aria-pressed="${selected === d.id}">
          <span class="file-badge">${esc(d.extension.slice(1).toUpperCase())}</span><span><strong>${esc(d.name)}</strong>
          <small>${esc(d.pageCount ? `${d.pageCount} page${d.pageCount === 1 ? "" : "s"} · ` : "")}${esc(STATUS[d.status] || d.status)}</small></span>
          ${BUSY.includes(d.status) ? '<span class="job-spinner" aria-label="Processing"></span>' : ""}</button>`).join("")
        : '<p class="empty">Your imported documents will appear here.</p>';
      if (selected) {
        const item = documents.find((d) => d.id === selected);
        const next = JSON.stringify([item, session.connection, result.access]);
        if (force || signature !== next) {
          const detail = await api(`/api/documents/${selected}`);
          if (!host || generation !== revision || detail.id !== selected) return;
          signature = next;
          renderDetail(detail);
        }
      }
    } catch (error) { if (generation === revision) notice(error.message, true); }
    finally { if (generation === revision) refreshing = false; }
  }

  async function upload(files) {
    if (!getSession().access.canWrite) return notice("This workspace is read-only. Open a writable development case to add documents.", true);
    const revision = generation;
    for (const file of Array.from(files).slice(0, 20)) {
      if (!host || revision !== generation) return;
      if (!/\.(pdf|txt|md)$/i.test(file.name) || !file.size || file.size > 20 * 1024 * 1024) {
        notice(`${file.name}: choose a non-empty PDF, TXT or Markdown file up to 20 MB.`, true); continue;
      }
      notice(`Adding ${file.name} to your local case…`);
      try {
        const result = await api(`/api/documents?name=${encodeURIComponent(file.name)}`, { method: "POST", body: file, raw: true });
        if (revision !== generation) return;
        selected = result.document.id;
        notice(result.duplicate ? `${file.name} is already in this case. No duplicate was created.` : `${file.name} added. Reading locally; no analysis has been sent.`);
        await refresh(true);
      } catch (error) { notice(`${file.name}: ${error.message}`, true); }
    }
  }

  function renderDetail(d) {
    const session = getSession(), connection = session.connection, writable = session.access.canWrite;
    const hasText = d.pages.some((p) => p.text.trim()), running = BUSY.includes(d.status);
    const related = documents.filter((item) => item.id !== d.id && item.pageCount && item.status !== "needs_ocr" && !["queued_read", "reading"].includes(item.status));
    const pageContent = d.pages.length ? `<details class="source-pages"><summary>Read extracted text (${d.pages.length} page${d.pages.length === 1 ? "" : "s"})</summary>
      ${d.pages.map((p) => `<details><summary>Page ${p.page}${p.text ? "" : " · no text found"}</summary><pre>${esc(p.text || "No text was extracted from this page.")}</pre></details>`).join("")}</details>` : "";
    host.querySelector("#document-detail").innerHTML = `
      <div class="detail-header"><span class="eyebrow">${esc(STATUS[d.status] || d.status)}</span><h2>${esc(d.name)}</h2>
      <p>${(d.bytes / 1024).toFixed(1)} KB${d.pageCount ? ` · ${d.pageCount} pages` : ""} · Original preserved locally</p>
      <button class="text-button" data-action="original" type="button">Save a copy of original</button></div>
      <div class="detail-body">
      ${d.error ? `<p class="workflow-warning" role="status">${esc(d.error)}</p>` : ""}
      ${d.emptyPages?.length && d.status !== "needs_ocr" ? `<p class="workflow-warning">No text was found on pages ${d.emptyPages.join(", ")}. Analysis will be incomplete for these pages. Review the original.</p>` : ""}
      ${running ? `<div class="job-progress"><span class="job-spinner"></span><p>${d.status === "reading" || d.status === "queued_read" ? "Reading this document on your computer…" : "Preparing sourced findings. This can take a few minutes."}</p><button class="btn small" data-action="cancel" type="button">Cancel job</button></div>` : ""}
      ${!running && !d.saved && hasText ? `<section class="analysis-setup"><h3>${d.draft ? "Run another analysis" : "Analyse this document"}</h3>
        <p>${connection ? `${esc(LABEL[connection.provider])} · ${esc(connection.model)}` : "Connect your AI to start."}</p>
        ${related.length ? `<details class="comparison-picker"><summary>Compare with other imported documents (up to 3)</summary>${related.map((item) => `<label><input type="checkbox" name="related" value="${item.id}"> ${esc(item.name)}</label>`).join("")}</details>` : ""}
        ${connection?.cloud ? `<label class="consent"><input type="checkbox" id="analysis-consent"> <span>Send extracted text from this document and any selected comparison documents to Claude for this analysis. Provider usage limits or API charges apply.</span></label>` : connection ? '<p class="local-note">Text is sent to the local Ollama service on this computer.</p>' : ""}
        <button class="btn primary" data-action="analyse" type="button" ${!writable || !connection ? "disabled" : ""}>${d.draft ? "Reanalyse document" : "Analyse document"}</button>
        ${!connection ? '<button class="btn" data-action="connect" type="button">Connect AI</button>' : ""}
        </section>` : ""}
      ${!running && !hasText && !d.saved && d.status !== "needs_ocr" ? `<button class="btn" data-action="retry" type="button" ${writable ? "" : "disabled"}>Retry reading</button>` : ""}
      ${d.saved ? `<div class="saved-notice"><h3>Reviewed findings saved</h3><p>${d.saved.findingIds.length} findings saved to your local case. Timeline events and evidence now appear in the dashboard.</p><p class="file-location">${esc(d.saved.folder)}</p></div>` : ""}
      ${d.draft ? reviewMarkup(d, writable && d.status === "review" && !running) : ""}
      ${pageContent}</div>`;
  }

  function reviewMarkup(d, writable) {
    const draft = d.draft;
    return `<section class="findings-review" data-draft-id="${esc(draft.id)}"><div class="review-heading"><h3>${d.saved ? "Analysis record" : "Review the findings"}</h3><span>${draft.findings.length} findings</span></div>
      <p class="review-intro">${esc(draft.summary)}</p>
      <p class="review-help">A matching quote confirms the passage exists, not that an allegation is true. Check attribution, dates and context. Select only findings you want to save.</p>
      ${draft.limitations.length ? `<details class="analysis-limits" open><summary>Analysis limitations</summary><ul>${draft.limitations.map((s) => `<li>${esc(s)}</li>`).join("")}</ul></details>` : ""}
      ${draft.partialPages?.length ? `<p class="workflow-warning">Unreadable pages: ${draft.partialPages.map(esc).join("; ")}</p>` : ""}
      ${draft.findings.length ? draft.findings.map((f) => `<article class="finding ${f.verified ? "" : "unverified"}">
        <label class="finding-choice"><input type="checkbox" name="finding" value="${esc(f.id)}" ${!writable || !f.verified || d.saved ? "disabled" : ""} ${d.saved?.findingIds.includes(f.id) ? "checked" : ""}>
        <span><small>${esc(KIND[f.kind])}${f.date ? ` · ${esc(f.date)}` : ""}</small><strong>${esc(f.title)}</strong></span></label>
        <p>${esc(f.detail)}</p><span class="quote-match ${f.verified ? "matched" : ""}">${f.verified ? "Source quotes matched · review still required" : "Cannot save · source or date check failed"}</span>
        ${f.issues.map((s) => `<p class="workflow-warning">${esc(s)}</p>`).join("")}
        ${f.sources.map((s) => `<details class="finding-source"><summary>${esc(s.name)} · page ${s.page}${s.matched ? "" : " · quote not matched"}</summary><blockquote>${esc(s.quote)}</blockquote>
          <button class="text-button" data-source="${esc(s.documentId)}" data-page="${s.page}" type="button">Read source page</button></details>`).join("")}
      </article>`).join("") : '<p class="empty">No sourced findings were returned. Nothing has been added to the case.</p>'}
      ${!d.saved && draft.findings.length ? `<div class="review-actions"><button class="btn primary" data-action="approve" type="button" ${writable ? "" : "disabled"}>Save selected findings to case</button><p>This creates new notes and leaves existing case files untouched.</p></div>` : ""}
    </section>`;
  }

  async function handleClick(event) {
    const item = event.target.closest("[data-document]");
    if (item) { selected = item.dataset.document; signature = ""; await refresh(true); return; }
    const source = event.target.closest("[data-source]");
    if (source) {
      try {
        const doc = await api(`/api/documents/${source.dataset.source}`);
        const page = doc.pages.find((p) => p.page === Number(source.dataset.page));
        showModal(`<h2 class="modal-title">${esc(doc.name)} · page ${Number(source.dataset.page)}</h2><pre class="source-modal">${esc(page?.text || "This source page is unavailable.")}</pre>`);
      } catch (error) { notice(error.message, true); }
      return;
    }
    const button = event.target.closest("[data-action]");
    if (!button || button.disabled) return;
    const action = button.dataset.action, id = selected;
    if (action === "connect") { await connectionModal(); return; }
    button.disabled = true;
    try {
      if (action === "original") {
        const blob = await api(`/api/documents/${id}/original`, { blob: true });
        const url = URL.createObjectURL(blob), a = document.createElement("a");
        a.href = url; a.download = documents.find((d) => d.id === id).name; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else if (action === "analyse") {
        const relatedIds = [...host.querySelectorAll('input[name="related"]:checked')].map((i) => i.value);
        await api(`/api/documents/${id}/analyse`, { method: "POST", body: { relatedIds, consent: host.querySelector("#analysis-consent")?.checked === true } });
        notice("Analysis queued. You can keep using the app while it works.");
      } else if (action === "approve") {
        const findingIds = [...host.querySelectorAll('input[name="finding"]:checked:not(:disabled)')].map((i) => i.value);
        if (!findingIds.length) throw new Error("Select at least one source-matched finding after reviewing it.");
        await api(`/api/documents/${id}/approve`, { method: "POST", body: { findingIds, draftId: host.querySelector("[data-draft-id]").dataset.draftId } });
        await onSaved(); notice("Selected findings saved. Your timeline and evidence matrix are up to date.");
      } else if (["retry", "cancel"].includes(action)) {
        await api(`/api/documents/${id}/${action}`, { method: "POST", body: {} });
        notice(action === "cancel" ? "Job cancelled. Your original document is preserved." : "Document queued for reading.");
      }
      await refresh(true);
    } catch (error) { notice(error.message, true); }
    finally { button.disabled = false; }
  }

  async function connectionModal() {
    const session = getSession();
    showModal(`<h2 class="modal-title">Connect your AI</h2><p class="modal-p">Your case stays on this computer. Choose where its selected text is analysed.</p>
      <form id="connection-form" class="connection-form">
        <label>Connection<select id="provider-choice"><option value="claude-code">Existing Claude sign-in · development preview</option><option value="anthropic">Claude API key</option><option value="ollama">Local model · Ollama</option></select></label>
        <div id="connection-fields"></div><p id="connection-message" class="inbox-message" role="status"></p>
        <button class="btn primary" id="connect-submit" type="submit">Check connection</button>
        ${session.connection ? '<button class="btn" id="disconnect-ai" type="button">Disconnect AI</button>' : ""}
      </form>`);
    const choice = document.getElementById("provider-choice");
    if (session.connection) choice.value = session.connection.provider;
    const fields = () => {
      const provider = choice.value;
      document.getElementById("connection-fields").innerHTML = provider === "claude-code"
        ? `<p class="modal-p">${session.claudeCodeEnabled ? "Uses your separately installed and signed-in Claude Code. Claude Desktop/Cowork alone does not provide this connection. Your existing account limits apply. This preview does not offer public subscription sign-in." : "Existing-subscription connection is not enabled in this build. Public provider sign-in is still being verified. Use an API key or local model to try analysis."}</p>`
        : `<label>Model name<input id="provider-model" required autocomplete="off" placeholder="${provider === "ollama" ? "Exact model name from Ollama" : "Full Claude API model ID"}" value="${session.connection?.provider === provider ? esc(session.connection.model) : ""}"></label>
        ${provider === "anthropic" ? '<label>API key<input id="provider-key" type="password" required autocomplete="off" placeholder="Paste your API key"></label><p class="modal-p">Held in memory for this app session only. Never saved in your case folder. API billing is separate from your AI subscription.</p>' : '<p class="modal-p">Start Ollama and install a local model first. This connects only to Ollama on this computer; cloud-routed models are not accepted.</p>'}`;
      document.getElementById("connect-submit").disabled = !session.access.canWrite || (provider === "claude-code" && !session.claudeCodeEnabled);
    };
    choice.addEventListener("change", fields); fields();
    document.getElementById("disconnect-ai")?.addEventListener("click", async () => {
      try { updateSession({ ...getSession(), ...await api("/api/providers/disconnect", { method: "POST", body: {} }) }); closeModal(); await refresh(true); }
      catch (error) { document.getElementById("connection-message").textContent = error.message; }
    });
    document.getElementById("connection-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = document.getElementById("connect-submit"), message = document.getElementById("connection-message");
      button.disabled = true; message.textContent = "Checking connection. No case documents are sent during this check…";
      const body = { provider: choice.value, model: document.getElementById("provider-model")?.value.trim(), apiKey: document.getElementById("provider-key")?.value.trim() };
      try {
        const result = await api("/api/providers/connect", { method: "POST", body });
        const key = document.getElementById("provider-key"); if (key) key.value = "";
        updateSession({ ...getSession(), ...result }); closeModal(); await refresh(true);
      } catch (error) { message.textContent = error.message; button.disabled = false; }
    });
  }

  return { mount, unmount, refresh, connectionModal };
}
