import { readFile, writeFile, rename } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { withReleaseLock } from './release-lock.mjs';

export const releaseOwnerDir = join(process.env.LOCALAPPDATA || join(homedir(), '.local', 'share'), 'CaseForgeRelease');
const semver = /^\d+\.\d+\.\d+$/;
const terminal = entry => ['published', 'cancelled'].includes(entry.state);
const checkout = root => process.platform === 'win32' ? resolve(root).toLowerCase() : resolve(root);
export function createReleaseQueue({ directory = releaseOwnerDir } = {}) {
  const path = join(directory, 'queue.json'), mutex = join(directory, 'queue.lock');
  async function read() {
    try {
      const data = JSON.parse(await readFile(path, 'utf8')), ids = new Set(), requests = new Set();
      if (data.schema !== 1 || !Array.isArray(data.entries)) throw Error('Invalid release queue.');
      for (const e of data.entries) {
        if (!e || typeof e.id !== 'string' || ids.has(e.id) || typeof e.requestId !== 'string' || requests.has(e.requestId) || typeof e.checkout !== 'string' || typeof e.message !== 'string' || !e.message.trim() || typeof e.required !== 'boolean' || !['queued','active','publishing','published','cancelled'].includes(e.state) || (e.version && !semver.test(e.version)) || (['active','publishing','published'].includes(e.state) && !e.version)) throw Error('Invalid release queue. Inspect it before continuing.');
        ids.add(e.id); requests.add(e.requestId);
      }
      return data;
    }
    catch (error) { if (error.code === 'ENOENT') return { schema: 1, entries: [] }; throw error; }
  }
  async function edit(action) {
    // Short queue mutations wait for each other; build/upload never hold this mutex.
    for (let attempt = 0; ; attempt++) {
      try { return await withReleaseLock('queue', async () => {
        const data = await read(), result = await action(data);
        await writeFile(path + '.tmp', JSON.stringify(data, null, 2)); await rename(path + '.tmp', path); return result;
      }, mutex); } catch (error) {
        if (attempt >= 100 || !/already running|starting/.test(error.message)) throw error;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
  }
  const owned = (data, id, root) => {
    const entry = data.entries.find(item => item.id === id);
    if (!entry || checkout(entry.checkout) !== checkout(root)) throw Error('Choose a queue entry belonging to this checkout.');
    return entry;
  };
  return {
    async status(root) { const data = await read(); return { path, entries: data.entries, current: data.entries.find(e => checkout(e.checkout) === checkout(root) && !terminal(e)) || null }; },
    enqueue({ root, requestId, message, required, sourceCommit }) {
      if (typeof requestId !== 'string' || !requestId.trim() || requestId.length > 120 || typeof message !== 'string' || !message.trim() || message.length > 6000 || typeof required !== 'boolean') throw Error('Supply a stable request ID, message and boolean policy.');
      return edit(data => {
        const existing = data.entries.find(e => e.requestId === requestId);
        if (existing) {
          if (checkout(existing.checkout) !== checkout(root) || existing.message !== message.trim() || existing.required !== required) throw Error('This request ID belongs to different release content.');
          return existing;
        }
        if (data.entries.some(e => checkout(e.checkout) === checkout(root) && !terminal(e))) throw Error('This checkout already has a pending release. Use an isolated checkout for independent work.');
        const entry = { id: randomUUID(), requestId, checkout: resolve(root), sourceCommit, message: message.trim(), required, state: 'queued', submittedAt: new Date().toISOString() };
        data.entries.push(entry); return entry;
      });
    },
    claim({ root, id, latestVersion, mainCommit }) {
      if (!semver.test(latestVersion) || !/^[a-f0-9]{40}$/.test(mainCommit)) throw Error('Read the latest published version and main commit before claiming a release.');
      return edit(data => {
        const entry = owned(data, id, root), head = data.entries.find(e => !terminal(e));
        if (terminal(entry)) return entry;
        if (head.id !== id) return { state: 'waiting', id, position: data.entries.filter(e => !terminal(e)).findIndex(e => e.id === id) + 1, blockedBy: head.id };
        if (entry.state !== 'queued') return entry;
        const versions = [latestVersion, ...data.entries.filter(e => e.version).map(e => e.version)].map(v => v.split('.').map(Number));
        versions.sort((a, b) => a[0]-b[0] || a[1]-b[1] || a[2]-b[2]);
        const next = versions.at(-1); next[2]++;
        Object.assign(entry, { state: 'active', version: next.join('.'), mainCommit, claimedAt: new Date().toISOString() }); return entry;
      });
    },
    async assertTurn(root, value = {}) {
      const { entries } = await this.status(root), entry = entries.find(e => !terminal(e));
      if (!entry || checkout(entry.checkout) !== checkout(root) || !['active', 'publishing'].includes(entry.state)) throw Error('Enqueue this release and claim the first queue position before building or publishing.');
      if (value.version && value.version !== entry.version) throw Error(`The queue reserved version ${entry.version}. Update the candidate version before continuing.`);
      if (value.message !== undefined && value.message.trim() !== entry.message || value.required !== undefined && value.required !== entry.required) throw Error('Prepared message or policy differs from the queued request.');
      return entry;
    },
    async assertCandidate(root, value) {
      // The verifier is launched afresh even by older long-lived MCP processes.
      // A completed release may be reverified; an unqueued candidate may not.
      const { entries } = await this.status(root);
      const published = entries.find(e => checkout(e.checkout) === checkout(root) && e.state === 'published' && e.version === value.version && e.message === value.message.trim() && e.required === value.required);
      return published || this.assertTurn(root, value);
    },
    publishing(root, id) { return edit(data => { const entry = owned(data, id, root); if (!['active','publishing'].includes(entry.state)) throw Error('Release is not active.'); entry.state = 'publishing'; return entry; }); },
    complete(root, id, url) { return edit(data => { const entry = owned(data, id, root); if (!['active','publishing','published'].includes(entry.state)) throw Error('Release is not active.'); Object.assign(entry, { state: 'published', url, publishedAt: new Date().toISOString() }); return entry; }); },
    failed(root, id, error) { return edit(data => { const entry = owned(data, id, root); if (terminal(entry)) return entry; entry.state = 'active'; entry.lastError = String(error).slice(0, 1000); return entry; }); },
    cancel(root, id) { return edit(data => { const entry = owned(data, id, root); if (entry.state === 'publishing' || entry.state === 'published') throw Error('Cannot cancel a publishing or published release.'); entry.state = 'cancelled'; entry.cancelledAt = new Date().toISOString(); return entry; }); },
  };
}
export const releaseQueue = createReleaseQueue();
