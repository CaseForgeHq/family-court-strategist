import { statSync, mkdirSync, rmdirSync } from 'node:fs';
import { caseRoot, readJson, writeJson, safePath } from './files.js';
import { AppError } from './errors.js';
import { documentSections } from '../public/document-model.js';
const STORE = '.case-forge/notebook/pages.json', LOCK = '.case-forge/notebook/write.lock';
const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export class Notebook {
  constructor(root, { assertWritable = () => {}, collection = 'notebook' } = {}) { if (!['notebook', 'documents'].includes(collection)) throw new Error('Invalid collection'); this.root = caseRoot(root); this.assertWritable = assertWritable; this.store = `.case-forge/${collection}/pages.json`; this.lock = `.case-forge/${collection}/write.lock`; this.bodyLimit = collection === 'documents' ? 60000 : 8000; }
  read() {
    let state;
    try {
      if (statSync(safePath(this.root, this.store)).size > 16000000) throw new AppError('Notebook storage is too large to edit.', 409);
      state = readJson(this.root, this.store);
    } catch (error) { if (error.code === 'ENOENT') return { version: 1, pages: {} }; throw error; }
    if (state.version !== 1 || !state.pages || Array.isArray(state.pages) || Object.entries(state.pages).some(([id, page]) => !ID.test(id) || page.id !== id || !Array.isArray(page.revisions) || !page.revisions.length || page.revisions.some((r, i) => r.revision !== i + 1 || typeof r.title !== 'string' || typeof r.body !== 'string' || !Number.isFinite(Date.parse(r.savedAt))))) throw new AppError('Notebook storage could not be read. Restore a known backup before editing.', 409);
    return state;
  }
  list() { return Object.values(this.read().pages).filter(page => !page.deletedAt).map(page => ({ id: page.id, ...page.revisions.at(-1) })).sort((a, b) => b.savedAt.localeCompare(a.savedAt)); }
  delete(input) {
    this.assertWritable(this.root);
    if (!input || !ID.test(input.id) || !Number.isInteger(input.expectedRevision)) throw new AppError('Reopen the page before deleting.', 409);
    const lock = safePath(this.root, this.lock, true);
    try { mkdirSync(lock); } catch (error) { if (error.code === 'EEXIST') throw new AppError('Another page is being saved. Try again shortly.', 409); throw error; }
    try {
      const state = this.read(), page = state.pages[input.id];
      if (!page || page.deletedAt || page.revisions.length !== input.expectedRevision) throw new AppError('This page changed. Reopen the notebook before deleting.', 409);
      // Retain revisions locally and reject delayed writes to a deleted page.
      page.deletedAt = new Date().toISOString();
      this.assertWritable(this.root); writeJson(this.root, this.store, state);
      return { id: input.id, deleted: true };
    } finally { rmdirSync(lock); }
  }
  save(input) {
    this.assertWritable(this.root);
    if (!input || !ID.test(input.id) || !Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) throw new AppError('Reopen the page before saving.', 409);
    for (const [key, max] of [['title', 140], ['body', this.bodyLimit]]) if (typeof input[key] !== 'string' || input[key].length > max || input[key].includes('\0')) throw new AppError(`Enter a ${key} up to ${max} characters.`);
    if (!input.body.trim() && !input.title.trim()) throw new AppError('Write something on the page before saving.');
    let sections;
    if (this.bodyLimit === 60000 && input.sections !== undefined) {
      try { sections = documentSections(input); } catch(e) { throw new AppError(e.message); }
      if (sections.filter(s=>s.type!=='title'&&s.text.trim()).map(s=>s.text).join('\n\n') !== input.body) throw new AppError('Document text and sections disagree. Reopen the draft.');
    }
    const lock = safePath(this.root, this.lock, true);
    try { mkdirSync(lock); } catch (error) { if (error.code === 'EEXIST') throw new AppError('Another page is being saved. Try again shortly.', 409); throw error; }
    try {
      const state = this.read(), page = state.pages[input.id] || { id: input.id, revisions: [] };
      if (page.deletedAt) throw new AppError('This page was deleted. Copy your text into a new page.', 409);
      if (page.revisions.length !== input.expectedRevision) throw new AppError('This page has a newer saved version. Your draft is still here; reopen the saved page before making changes.', 409);
      if (!state.pages[input.id] && Object.keys(state.pages).length >= 500) throw new AppError('This notebook already has 500 pages.');
      const saved = { title: input.title.trim() || 'Untitled page', body: input.body, revision: input.expectedRevision + 1, savedAt: new Date().toISOString() };
      if (sections) saved.sections = sections.map(s=>s.type==='title'?{...s,text:saved.title}:s);
      page.revisions.push(saved); state.pages[input.id] = page;
      if (Buffer.byteLength(JSON.stringify(state)) > 16000000) throw new AppError('Notebook storage is too large to edit.', 409);
      this.assertWritable(this.root); writeJson(this.root, this.store, state); return { id: page.id, ...saved };
    } finally { rmdirSync(lock); }
  }
}
