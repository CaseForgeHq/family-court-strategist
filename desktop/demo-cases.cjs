const { join, resolve } = require('node:path');
const { mkdirSync, readFileSync, writeFileSync, renameSync, realpathSync, statSync, existsSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

function createDemoCases({ profileDir, generate, presets }) {
  const store = join(profileDir, 'demo-cases.json'), folderRoot = join(profileDir, 'Demo cases');
  function read() {
    if (!existsSync(store)) return { version: 1, entries: [], returnFolder: null };
    if (statSync(store).size > 128000) throw new Error('The demo list could not be read.');
    const state = JSON.parse(readFileSync(store, 'utf8'));
    if (state.version !== 1 || !Array.isArray(state.entries) || state.entries.length > 100 || (state.returnFolder !== null && typeof state.returnFolder !== 'string') || state.entries.some(e => !e || !UUID.test(e.id) || !presets.some(p => p.id === e.size) || !Number.isFinite(Date.parse(e.createdAt)))) throw new Error('The demo list could not be read.');
    return state;
  }
  function save(state) {
    writeFileSync(`${store}.tmp`, JSON.stringify(state), { mode: 0o600 });
    renameSync(`${store}.tmp`, store);
  }
  function folder(id) {
    if (!UUID.test(id)) throw new Error('Choose a saved demo case.');
    // Reject replaced folders/junctions; the renderer can choose an ID only.
    const parent = checkedParent(), expected = resolve(parent, id), actual = realpathSync(expected);
    if (actual !== expected || !statSync(actual).isDirectory()) throw new Error('That demo folder is unavailable.');
    return actual;
  }
  function checkedParent() {
    const actual = realpathSync(folderRoot);
    if (actual !== join(realpathSync(profileDir), 'Demo cases')) throw new Error('The demo storage folder has moved.');
    return actual;
  }
  function entryPath(entry) {
    const path = folder(entry.id);
    const manifest = JSON.parse(readFileSync(join(path, '.case-forge/demo.json'), 'utf8'));
    if (manifest.id !== entry.id || manifest.fictional !== true || manifest.size !== entry.size) throw new Error('That demo folder could not be verified.');
    return path;
  }
  function isDemo(path) {
    try { return read().entries.some(entry => { try { return entryPath(entry) === path; } catch { return false; } }); }
    catch { return false; }
  }
  return {
    isDemo,
    status(currentFolder) {
      const state = read();
      const entries = state.entries.map(entry => {
        const preset = presets.find(p => p.id === entry.size);
        let path = null; try { path = entryPath(entry); } catch { /* missing demos remain visible */ }
        return { ...entry, label: `Demo · ${preset.label}`, files: preset.files, available: !!path, current: path === currentFolder };
      }).reverse();
      let returnFolder = null;
      try { if (state.returnFolder && statSync(state.returnFolder).isDirectory()) returnFolder = realpathSync(state.returnFolder); } catch { /* drive may be disconnected */ }
      return { presets, entries, currentIsDemo: isDemo(currentFolder), returnFolder: returnFolder && returnFolder !== currentFolder ? returnFolder : null };
    },
    async create(size, assertActive) {
      const preset = presets.find(p => p.id === size);
      if (!preset) throw new Error('Choose Small, Medium or Large.');
      const state = read();
      if (state.entries.length >= 100) throw new Error('You have 100 saved demo cases. Reopen an existing demo.');
      assertActive();
      mkdirSync(folderRoot, { recursive: true });
      const id = randomUUID(), path = join(checkedParent(), id), createdAt = new Date().toISOString();
      mkdirSync(path);
      // Failed/interrupted generation is never registered or opened. No case
      // folder supplied by the renderer is accepted, merged into or deleted.
      await generate({ root: path, id, size, assertActive });
      assertActive();
      const entry = { id, size, createdAt };
      state.entries.push(entry); save(state);
      return { ...entry, path, label: `Demo · ${preset.label}` };
    },
    openPath(id) {
      const entry = read().entries.find(e => e.id === id);
      if (!entry) throw new Error('Choose a saved demo case.');
      return entryPath(entry);
    },
    rememberReturn(path) {
      if (!path || isDemo(path)) return;
      const state = read(); state.returnFolder = realpathSync(path); save(state);
    },
    returnPath() {
      const path = read().returnFolder;
      if (!path || !statSync(path).isDirectory()) throw new Error('Your previous case folder is unavailable. Choose its location in Current case.');
      return realpathSync(path);
    },
  };
}
module.exports = { createDemoCases };
