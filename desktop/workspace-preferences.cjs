const { readFileSync, writeFileSync, renameSync, unlinkSync, realpathSync, statSync } = require('node:fs');
const { basename, resolve } = require('node:path');
const { createHash } = require('node:crypto');
const { plans } = require('./ai-plans.js');

const MAX_BYTES = 1024 * 1024;
const PROVIDERS = new Set(['ollama', 'anthropic']);
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function validate(value) {
  if (!record(value) || typeof value.caseName !== 'string' || /[\u0000-\u001f\u007f-\u009f]/.test(value.caseName)) {
    throw new Error('Enter a case name of 1–80 characters without control characters.');
  }
  const caseName = value.caseName.trim();
  if (!caseName || caseName.length > 80) throw new Error('Enter a case name of 1–80 characters.');
  if (!PROVIDERS.has(value.preferredProvider)) throw new Error('Choose local Ollama or Claude API as your AI preference.');
  const result = { caseName, preferredProvider: value.preferredProvider };
  // These are preferences only. Neither field may be used as a paid entitlement.
  if (value.aiPlan !== undefined) {
    if (typeof value.aiPlan !== 'string' || !Object.hasOwn(plans, value.aiPlan)) throw new Error('Choose a valid plan preference.');
    if (typeof value.advancedIntelligence !== 'boolean') throw new Error('Choose whether to include the Astra option.');
    result.aiPlan = value.aiPlan;
    result.advancedIntelligence = value.advancedIntelligence;
  } else if (value.advancedIntelligence !== undefined) throw new Error('Choose a plan before the Astra option.');
  return result;
}

function folderIdentity(folder) {
  if (typeof folder !== 'string' || !folder) throw new Error('Choose an available case folder first.');
  const canonical = realpathSync(resolve(folder));
  if (!statSync(canonical).isDirectory()) throw new Error('Choose an available case folder first.');
  return { folderKey: createHash('sha256').update(canonical).digest('hex'), caseName: basename(canonical) };
}

function createWorkspacePreferences(path) {
  function read() {
    let bytes;
    try {
      if (statSync(path).size > MAX_BYTES) throw new Error('Saved workspace preferences are too large.');
      bytes = readFileSync(path, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return { version: 1, folders: {} };
      throw error;
    }
    const value = JSON.parse(bytes);
    if (!record(value) || value.version !== 1 || !record(value.folders)) throw new Error('Invalid workspace preferences.');
    const folders = {};
    for (const [key, entry] of Object.entries(value.folders)) {
      if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid workspace folder key.');
      folders[key] = validate(entry);
    }
    return { version: 1, folders };
  }
  return {
    get(folder) {
      const identity = folderIdentity(folder);
      try {
        const saved = read().folders[identity.folderKey];
        if (saved) return { folderKey: identity.folderKey, ...saved, configured: true };
      } catch { /* A damaged preferences file must not prevent opening a case. */ }
      return { ...identity, preferredProvider: 'ollama', configured: false };
    },
    set(folder, value) {
      const identity = folderIdentity(folder), next = validate(value);
      let state;
      try { state = read(); }
      catch { throw new Error('Saved workspace preferences could not be read. Reset app setup before replacing them.'); }
      state.folders[identity.folderKey] = next;
      const content = JSON.stringify(state);
      if (Buffer.byteLength(content) > MAX_BYTES) throw new Error('Saved workspace preferences are too large.');
      // This path belongs to app userData; case folders are only resolved and read.
      writeFileSync(`${path}.tmp`, content, { mode: 0o600 });
      renameSync(`${path}.tmp`, path);
      return { folderKey: identity.folderKey, ...next, configured: true };
    },
    clear() {
      for (const target of [`${path}.tmp`, path]) {
        try { unlinkSync(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      return true;
    },
  };
}

module.exports = { createWorkspacePreferences };
