import { icon } from './icons.js';
import { fileRegister } from './file-register.js';
import { makeWindow } from './windows.js';
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const STATUS = { queued_read: "Waiting to read", reading: "Reading", ready: "Ready to analyse", queued: "Analysis queued", analysing: "Analysing", review: "Ready for review", saved: "Saved to case", failed: "Needs attention", cancelled: "Cancelled", interrupted: "Interrupted", needs_ocr: "Needs text recognition" };
const BUSY = ["queued_read", "reading", "queued", "analysing"];
const LABEL = { "claude-code": "Claude · existing sign-in", anthropic: "Claude · API key", ollama: "Ollama · local model" };
const KIND = { event: "Timeline event", claim: "Attributed claim", inconsistency: "Possible inconsistency", follow_up: "Follow-up" };

export function createInbox({ api, getSession, updateSession, showModal, closeModal, onSaved }) {
  let host = null, selected = null, documents = [], signature = "", timer = null, generation = 0;
  let refreshing = false, inspectorWindow = null, registerMarkup = '';

  function notice(message, error = false) {
    const element = host?.querySelector("#inbox-message");
    if (element) { element.textContent = message; element.classList.toggle("error", error); }
  }

  function mount(element) {
    unmount(); host = element;
    host.innerHTML = `<div class="page-purpose"><p>Read your files and review what AI finds.</p><span>Only findings you approve are added to Timeline and Evidence. Original files stay local.</span></div>
      <section class="card files-register-panel"><div class="desk-toolbar"><h2>Your files <span id="document-count">0</span></h2><div class="file-actions"><button class="btn" id="inbox-connect" type="button">${icon('ai')} Connect AI</button><label class="btn primary dropzone" id="document-drop" tabindex="0" role="button" aria-label="Add PDF or text documents">${icon('plus')} Add files<input id="document-picker" type="file" accept=".pdf,.txt,.md" multiple hidden></label></div></div><div id="document-list"></div>
      <div class="inbox-status-row"><small>PDF, TXT or Markdown · up to 20 MB per file · drag files onto Add files</small><div class="inbox-access" id="inbox-access" role="status"></div></div></section><p id="inbox-message" class="inbox-message" role="status" aria-live="polite"></p>
      <section class="card inbox-detail" id="document-inspector" aria-label="Document inspector" hidden><div id="document-detail"><div class="welcome-panel"><h3>Select a document</h3><p>Its contents and review tools will appear here.</p></div></div></section>`;
    inspectorWindow = makeWindow(host.querySelector('#document-inspector'), { title: 'Document', onClose: () => { host.querySelector('#document-inspector').hidden = true; host.querySelector('[data-document][aria-pressed="true"]')?.focus(); } });
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
    inspectorWindow?.destroy(); inspectorWindow = null;
    host = null; signature = ""; registerMarkup = ''; refreshing = false;
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
      host.querySelector("#inbox-access").textContent = `${result.access.canWrite ? "" : `${result.access.message}. `}${session.connection ? `${LABEL[session.connection.provider]} connected` : "AI not connected"}`;
      host.querySelector("#document-picker").disabled = !result.access.canWrite;
      host.querySelector("#document-drop").setAttribute("aria-disabled", String(!result.access.canWrite));
      host.querySelector('#inbox-connect').innerHTML = icon('ai') + (session.connection ? ' AI connection' : ' Connect AI');
      host.querySelector("#document-count").textContent = documents.length;
      if (!selected || !documents.some((d) => d.id === selected)) selected = documents[0]?.id || null;
      const nextRegister = documents.length ? fileRegister(documents, { inbox: true, selected }) : '<p class="empty">Your imported documents will appear here. Add a file to begin.</p>';
      if (nextRegister !== registerMarkup) {
        const list = host.querySelector('#document-list'), rows = list.querySelector('.register-rows');
        const scrollTop = rows?.scrollTop || 0, scrollLeft = rows?.scrollLeft || 0;
        const focusRows = rows && document.activeElement === rows;
        const focusedDocument = list.contains(document.activeElement) ? document.activeElement.dataset.document : null;
        list.innerHTML = nextRegister; registerMarkup = nextRegister;
        const nextRows = list.querySelector('.register-rows');
        if (nextRows) {
          nextRows.scrollTop = scrollTop; nextRows.scrollLeft = scrollLeft;
          if (focusRows) nextRows.focus({ preventScroll: true });
          else if (focusedDocument) Array.from(list.querySelectorAll('[data-document]')).find(el => el.dataset.document === focusedDocument)?.focus({ preventScroll: true });
        }
      }
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
        selected = result.document.id; host.querySelector('#document-inspector').hidden = false;
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
      <div class="detail-header"><p class="record-link file-reference">${esc(d.reference || "")}</p><span class="eyebrow">${esc(STATUS[d.status] || d.status)}</span><h2>${esc(d.name)}</h2>
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
      ${d.saved ? `<div class="saved-notice"><h3>Reviewed findings saved</h3><p>${d.saved.findingIds.length} findings saved to your local case. Find saved events in <button type="button" class="record-link" data-go="timeline">Timeline</button> and claims in <button type="button" class="record-link" data-go="evidence">Evidence matrix</button>.</p><p class="file-location">${esc(d.saved.folder)}</p></div>` : ""}
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
    if (item) { host.querySelector('#document-inspector').hidden = false; selected = item.dataset.document; signature = ""; await refresh(true); return; }
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
        <label>Where should AI analyse your files?<select id="provider-choice"><option value="ollama">On this computer · Ollama</option><option value="anthropic">Optional cloud AI · Claude API</option><option value="claude-code">Existing Claude sign-in · development preview</option></select></label>
        <div id="connection-fields"></div><p id="connection-message" class="inbox-message" role="status"></p>
        <button class="btn primary" id="connect-submit" type="submit">Check connection</button>
        ${session.connection ? '<button class="btn" id="disconnect-ai" type="button">Disconnect AI</button>' : ""}
      </form>`);
    const choice = document.getElementById("provider-choice");
    const preferredProvider = session.workspacePreferences?.preferredProvider;
    choice.value = session.connection?.provider || (["ollama", "anthropic"].includes(preferredProvider) ? preferredProvider : "ollama");
    const fields = () => {
      const provider = choice.value;
      document.getElementById("connection-fields").innerHTML = provider === "claude-code"
        ? `<p class="modal-p">${session.claudeCodeEnabled ? "Uses your separately installed and signed-in Claude Code. Claude Desktop/Cowork alone does not provide this connection. Your existing account limits apply. This preview does not offer public subscription sign-in." : "Existing-subscription connection is not enabled in this build. Public provider sign-in is still being verified. Use an API key or local model to try analysis."}</p>`
        : provider === "ollama"
          ? `<p class="modal-p">Ollama is a separate app that runs AI on this computer. Install and open Ollama with a local model first. Neither the engine nor a model is included with Case Forge.</p>
            <button class="btn" id="find-local-models" type="button">Find models on this computer</button>
            <p id="local-models-message" class="inbox-message" role="status" aria-live="polite"></p>
            <div id="local-model-options" hidden><label>Choose an installed model<select id="local-model-picker"><option value="">Choose a model…</option></select></label></div>
            <details${session.connection?.provider === "ollama" ? " open" : ""}><summary>Enter a model name yourself</summary><label>Model name<input id="provider-model" autocomplete="off" placeholder="Model name from your Ollama app" value="${session.connection?.provider === "ollama" ? esc(session.connection.model) : ""}"></label></details>
            <p class="modal-p">This check reads model names on this computer. It does not analyse your files, install anything or download a model.</p>`
          : `<label>Model name<input id="provider-model" required autocomplete="off" placeholder="Full Claude API model ID" value="${session.connection?.provider === provider ? esc(session.connection.model) : ""}"></label><label>API key<input id="provider-key" type="password" required autocomplete="off" placeholder="Paste your API key"></label><p class="modal-p">Held in memory for this app session only. Never saved in your case folder. API billing is separate from your AI subscription.</p>`;
      document.getElementById("connect-submit").disabled = !session.access.canWrite || (provider === "claude-code" && !session.claudeCodeEnabled);
      const findModels = document.getElementById("find-local-models");
      if (findModels) {
        const modelInput = document.getElementById("provider-model"), picker = document.getElementById("local-model-picker");
        picker.addEventListener("change", () => { modelInput.value = picker.value; });
        modelInput.addEventListener("input", () => { picker.value = [...picker.options].some((option) => option.value === modelInput.value) ? modelInput.value : ""; });
        findModels.addEventListener("click", async () => {
          const message = document.getElementById("local-models-message"), optionsHost = document.getElementById("local-model-options");
          findModels.disabled = true; message.textContent = "Looking for installed models on this computer…";
          optionsHost.hidden = true;
          try {
            const result = await api("/api/providers/local-models");
            if (!findModels.isConnected || choice.value !== "ollama" || getSession().caseKey !== session.caseKey) return;
            message.textContent = result.message;
            picker.innerHTML = `<option value="">Choose a model…</option>${result.models.map((item) => `<option value="${esc(item.name)}">${esc(item.name)}</option>`).join("")}`;
            if (result.models.some((item) => item.name === modelInput.value)) picker.value = modelInput.value;
            optionsHost.hidden = !result.models.length;
          } catch (error) { if (findModels.isConnected) message.textContent = error.message; }
          finally { if (findModels.isConnected) findModels.disabled = false; }
        });
      }
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
      if (body.provider === "ollama" && !body.model) {
        message.textContent = "Find and choose an installed model, or enter its name yourself.";
        button.disabled = !session.access.canWrite; document.getElementById("find-local-models")?.focus(); return;
      }
      try {
        const result = await api("/api/providers/connect", { method: "POST", body });
        const key = document.getElementById("provider-key"); if (key) key.value = "";
        updateSession({ ...getSession(), ...result }); closeModal(); await refresh(true);
      } catch (error) { message.textContent = error.message; button.disabled = false; }
    });
  }

  return { mount, unmount, refresh, connectionModal, open: (id) => { if (host) host.querySelector('#document-inspector').hidden = false; selected = id; signature = ""; return refresh(true); } };
}
