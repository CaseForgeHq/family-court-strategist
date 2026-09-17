const { readFile, writeFile, rename, mkdir } = require('node:fs/promises');
const { join } = require('node:path');
const VERSION = /^\d+\.\d+\.\d+$/;
const compare = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); return x[0]-y[0] || x[1]-y[1] || x[2]-y[2]; };
function validateMessages(feed, currentVersion) {
  if (feed?.schema !== 1 || !VERSION.test(feed.latestVersion) || !Array.isArray(feed.entries) || feed.entries.length > 2000) throw Error('Invalid update messages.');
  const seen = new Set();
  const entries = feed.entries.map(entry => {
    if (!entry || !VERSION.test(entry.version) || entry.id !== `v${entry.version}` || seen.has(entry.id) || compare(entry.version, feed.latestVersion) > 0 || typeof entry.message !== 'string' || !entry.message.trim() || entry.message.length > 6000 || !Number.isFinite(Date.parse(entry.publishedAt))) throw Error('Invalid update message.');
    seen.add(entry.id); return { id: entry.id, version: entry.version, message: entry.message, publishedAt: entry.publishedAt };
  }).filter(entry => compare(entry.version, currentVersion) > 0).sort((a, b) => compare(b.version, a.version));
  if (compare(feed.latestVersion, currentVersion) > 0 && !seen.has(`v${feed.latestVersion}`)) throw Error('Latest update message is missing.');
  return entries;
}
function createUpdateMessages({ userData, version, fetch: fetcher = globalThis.fetch }) {
  const path = join(userData, 'update-messages.json'); let pending;
  return {
    async read() { try { return validateMessages(JSON.parse(await readFile(path, 'utf8')), version); } catch { return []; } },
    refresh() {
      if (pending) return pending;
      pending = (async () => {
        // Public static release asset, not the rate-limited GitHub API. Shared 10s cache bucket.
        const url = 'https://github.com/CaseForgeHq/family-court-strategist/releases/latest/download/update-messages.json?check=' + Math.floor(Date.now()/10000);
        const response = await fetcher(url, { headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw Error('Update messages unavailable.');
        let size = 0; const chunks = [];
        for await (const chunk of response.body) { size += chunk.length; if (size > 8 * 1024 * 1024) throw Error('Update messages too large.'); chunks.push(Buffer.from(chunk)); }
        const feed = JSON.parse(Buffer.concat(chunks).toString('utf8')), entries = validateMessages(feed, version);
        try {
          const cached = JSON.parse(await readFile(path, 'utf8'));
          if (VERSION.test(cached.latestVersion) && compare(cached.latestVersion, feed.latestVersion) > 0) return validateMessages(cached, version);
        } catch { /* First fetch or damaged local cache: validated public feed wins. */ }
        await mkdir(userData, { recursive: true });
        await writeFile(path + '.tmp', JSON.stringify({ ...feed, entries })); await rename(path + '.tmp', path);
        return entries;
      })().finally(() => { pending = null; });
      return pending;
    },
  };
}
module.exports = { createUpdateMessages, validateMessages, compare };
