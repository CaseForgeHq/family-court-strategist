import { esc } from './file-register.js';
import { icon } from './icons.js';
export function createNotebook({ api, getSession, onExport }) {
  let host, key, pages = [], draft = null, dirty = false, busy = false, generation = 0, timer, pendingSave, switching = false;
  const find = selector => host?.querySelector(selector);
  const unload = event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
  function changed(value) { dirty = value; window.removeEventListener('beforeunload', unload); if (dirty) window.addEventListener('beforeunload', unload); }
  const blank = () => ({ id: window.crypto.randomUUID(), expectedRevision: 0, title: '', body: '' });
  function notice(text) { if (find('#notebook-status')) find('#notebook-status').textContent = text; }
  function unmount() { clearTimeout(timer); if (dirty && !busy) void save(); generation++; host = null; }
  function pageList() {
    return pages.length ? pages.map(p => `<div class="notebook-page-row ${draft.id === p.id ? 'on' : ''}"><button type="button" data-notebook-page="${p.id}"><span>${esc(p.title)}</span><small>${esc(new Date(p.savedAt).toLocaleDateString('en-AU',{day:'numeric',month:'short'}))}</small></button>${getSession().access.canWrite ? `<button type="button" class="notebook-delete" data-notebook-delete="${p.id}" aria-label="Delete ${esc(p.title)}" title="Delete note">${icon('trash')}</button>` : ''}</div>`).join('') : '<p>Your saved pages<br>will appear here.</p>';
  }
  function bindPages() {
    host.querySelectorAll('[data-notebook-page]').forEach(button => button.addEventListener('click', () => switchPage(button.dataset.notebookPage)));
    host.querySelectorAll('[data-notebook-delete]').forEach(button => button.addEventListener('click', () => deletePage(button.dataset.notebookDelete)));
  }
  async function deletePage(id) {
    if (switching || !getSession().access.canWrite) return;
    const page = pages.find(p => p.id === id);
    if (!page || !window.confirm(`Delete “${page.title}”? This removes the note from your notebook.`)) return;
    switching = true;
    const editingKey = key, turn = generation;
    try {
      if (pendingSave) await pendingSave;
      if (!host || key !== editingKey || generation !== turn) return;
      const latest = pages.find(p => p.id === id);
      if (!latest) return;
      clearTimeout(timer); busy = true; render(); notice('Deleting…');
      await api('/api/notebook/delete', { method: 'POST', body: { id, expectedRevision: latest.revision } });
      if (key !== editingKey) return;
      pages = pages.filter(p => p.id !== id);
      if (draft.id === id) { draft = blank(); changed(false); }
      if (host) { busy = false; render(); notice('Note deleted'); find('#notebook-body').focus(); }
    } catch (error) {
      if (host && key === editingKey) { busy = false; render(); notice(`Could not delete: ${error.message}`); }
    } finally {
      busy = false; switching = false;
      if (dirty && key === editingKey) timer = setTimeout(() => void save(), 700);
    }
  }
  function render() {
    const writable = getSession().access.canWrite;
    host.innerHTML = `<section class="notebook-workspace"><div class="page-purpose"><p>Your place to think, prepare questions and keep working notes.</p><span>Saved only in this case folder.</span></div><div class="notebook-book"><aside class="notebook-index"><div class="notebook-cover-title">CASE FORGE<br><strong>Notebook</strong></div><button class="btn" id="notebook-new" ${!writable || busy ? 'disabled' : ''}>${icon('plus')} Blank page</button><div class="notebook-pages" aria-label="Saved pages">${pageList()}</div><span class="notebook-cover-mark">A little space to think.</span></aside><div class="notebook-binding" aria-hidden="true"></div><form class="notebook-paper" id="notebook-form"><div class="notebook-paper-top"><span>PERSONAL NOTES</span><time>${esc(new Date().toLocaleDateString('en-AU',{day:'numeric',month:'long',year:'numeric'}))}</time></div><label class="sr-only" for="notebook-title">Page title</label><input id="notebook-title" maxlength="140" placeholder="Untitled page" value="${esc(draft.title)}" ${!writable || busy ? 'disabled' : ''}><label class="sr-only" for="notebook-body">Write your notes</label><textarea id="notebook-body" maxlength="8000" placeholder="Start writing here…" spellcheck="true" ${!writable || busy ? 'disabled' : ''}>${esc(draft.body)}</textarea><div class="notebook-paper-footer"><span id="notebook-status" role="status">${dirty ? 'Unsaved changes' : draft.expectedRevision ? 'Saved on this computer' : 'A fresh page'}</span>${onExport ? '<button type="button" class="btn" id="notebook-export">Export PDF</button>' : ''}<button type="submit" class="btn primary" ${!writable || busy ? 'disabled' : ''}>${icon('check')} ${busy ? 'Saving…' : 'Save page'}</button></div></form></div></section>`;
    find('#notebook-form').addEventListener('input', () => { draft.title = find('#notebook-title').value; draft.body = find('#notebook-body').value; changed(true); notice('Waiting to save…'); clearTimeout(timer); timer = setTimeout(() => void save(), 700); });
    find('#notebook-form').addEventListener('submit', event => { event.preventDefault(); void save(); });
    find('#notebook-form').addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void save(); } });
    find('#notebook-export')?.addEventListener('click', () => onExport({title: draft.title || 'Untitled page', body: draft.body}));
    find('#notebook-new').addEventListener('click', () => switchPage());
    bindPages();
  }
  async function switchPage(id) {
    if (switching) return;
    switching = true;
    const turn = generation, editingKey = key;
    try {
    if (pendingSave && await pendingSave === false) return;
    if (!host || generation !== turn || key !== editingKey) return;
    if (dirty) { await save(); if (dirty) return; }
    if (!host || generation !== turn || key !== editingKey) return;
    const page = pages.find(item => item.id === id);
    draft = page ? { id: page.id, expectedRevision: page.revision, title: page.title, body: page.body } : blank();
    changed(false); render(); find('#notebook-body').focus();
    } finally { switching = false; }
  }
  function save() {
    if (pendingSave) return pendingSave;
    pendingSave = persist().finally(() => { pendingSave = null; });
    return pendingSave;
  }
  async function persist() {
    clearTimeout(timer);
    if (busy || !dirty || !getSession().access.canWrite || key !== getSession().caseKey) return;
    if (!draft.title.trim() && !draft.body.trim() && !draft.expectedRevision) { changed(false); notice('A fresh page'); return; }
    const editing = draft, snapshot = { ...draft }, editingKey = key;
    let message;
    busy = true; notice('Saving…');
    try {
      const saved = await api('/api/notebook', { method: 'POST', body: snapshot });
      if (draft === editing && key === editingKey) { draft.expectedRevision = saved.revision; changed(draft.title !== snapshot.title || draft.body !== snapshot.body); pages = [saved, ...pages.filter(p => p.id !== saved.id)]; }
      message = 'Saved on this computer';
    } catch (error) { message = error.message; return false; }
    finally {
      busy = false;
      if (host && key === editingKey) {
        // Keep the editor and Blank page button mounted while autosaving.
        const list = find('.notebook-pages');
        list.innerHTML = pageList();
        bindPages();
        host.querySelectorAll('#notebook-new, #notebook-title, #notebook-body, #notebook-form button[type="submit"]').forEach(control => { control.disabled = !getSession().access.canWrite; });
        find('#notebook-form button[type="submit"]').innerHTML = `${icon('check')} Save page`;
        notice(dirty ? message === 'Saved on this computer' ? 'Waiting to save…' : `Not saved: ${message}` : message);
      }
      if (dirty && message === 'Saved on this computer') timer = setTimeout(() => void save(), 700);
    }
  }
  async function mount(element) {
    unmount(); host = element; const turn = generation;
    if (key !== getSession().caseKey) { key = getSession().caseKey; draft = null; pages = []; changed(false); }
    draft ||= blank(); render();
    try {
      const result = await api('/api/notebook'); if (!host || generation !== turn) return;
      const latest = new Map(pages.map(page => [page.id, page]));
      for (const page of result.pages) if (!latest.has(page.id) || latest.get(page.id).revision < page.revision) latest.set(page.id, page);
      pages = [...latest.values()].sort((a, b) => b.savedAt.localeCompare(a.savedAt));
      find('.notebook-pages').innerHTML = pageList(); bindPages();
    }
    catch (error) { if (host && generation === turn) notice(error.message); }
  }
  return { mount, unmount, open: id => { if (host && pages.some(page => page.id === id)) switchPage(id); } };
}
