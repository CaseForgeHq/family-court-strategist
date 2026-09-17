// Owner-only local release console. Never ship this server or GitHub credentials in the client.
import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { withReleaseLock } from './release-lock.mjs';
import { releaseQueue } from './release-queue.mjs';
const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(new URL('../desktop/package.json', import.meta.url));
const yaml = require('js-yaml');
const repository = 'CaseForgeHq/family-court-strategist';
const dist = join(root, 'desktop/dist');
const command = (name, args) => exec(name, args, { cwd: root, windowsHide: true, timeout: 180000, maxBuffer: 32 * 1024 * 1024 });
const git = args => command('git', ['-c', `safe.directory=${root.replaceAll('\\', '/').replace(/\/$/, '')}`, ...args]);
export function validateReleaseInput(value) {
  if (!value || typeof value.message !== 'string' || !value.message.trim() || value.message.length > 6000 || typeof value.required !== 'boolean') throw Error('Enter a release message of 1–6,000 characters and select an update policy.');
  return { message: value.message.trim() + '\n', required: value.required };
}
async function candidate() {
  const pkg = JSON.parse(await readFile(join(root, 'desktop/package.json'), 'utf8'));
  if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) throw Error('Invalid release version.');
  const message = await readFile(join(root, 'releases/windows', `${pkg.version}.md`), 'utf8');
  let policy = { required: false };
  try { policy = JSON.parse(await readFile(join(root, 'releases/windows', `${pkg.version}.json`), 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return { version: pkg.version, message, required: policy.required === true, repository };
}
async function verify() { await command(process.execPath, ['scripts/prepare-desktop-release.mjs']); }
async function prepare(value) {
  const input = validateReleaseInput(value), info = await candidate();
  await releaseQueue.assertTurn(root, { ...info, ...input });
  if (value.version && value.version !== info.version) throw Error('Release version changed. Read the candidate again.');
  // Refuse stale binaries before altering metadata. Release notes are not executable code.
  await verify();
  const metadataPath = join(dist, 'latest.yml');
  const metadata = yaml.load(await readFile(metadataPath, 'utf8'));
  metadata.releaseNotes = input.message; metadata.caseForgeRequired = input.required;
  await writeFile(join(root, 'releases/windows', `${info.version}.md`), input.message);
  await writeFile(join(root, 'releases/windows', `${info.version}.json`), JSON.stringify({ required: input.required }, null, 2) + '\n');
  await writeFile(metadataPath, yaml.dump(metadata, { lineWidth: -1 }));
  await verify();
  return { ...await candidate(), result: 'Release prepared locally. Nothing has been published.' };
}
async function publish(value) {
  await verify();
  const info = await candidate(), tag = `v${info.version}`;
  const queued = await releaseQueue.assertTurn(root, info);
  if (value.version !== info.version || value.message !== info.message || value.required !== info.required) throw Error('The prepared release changed. Review and prepare it again.');
  const status = await git(['status', '--porcelain']);
  if (status.stdout.trim()) throw Error('Commit and review the release source first. Publication is blocked while the checkout has uncommitted files.');
  const head = (await git(['rev-parse', 'HEAD'])).stdout.trim();
  await git(['merge-base', '--is-ancestor', queued.mainCommit, head]);
  await git(['merge-base', '--is-ancestor', queued.sourceCommit, head]);
  const main = (await git(['ls-remote', 'origin', 'refs/heads/main'])).stdout.trim().split(/\s/)[0];
  if (main !== head) throw Error('Reconcile with current main and push the reviewed cumulative release before publishing.');
  if ((await git(['rev-parse', `${tag}^{commit}`])).stdout.trim() !== head) throw Error('The release tag must point to the reviewed source commit.');
  const remote = (await git(['ls-remote', 'origin', `refs/tags/${tag}`, `refs/tags/${tag}^{}`])).stdout;
  if (!remote.split(/\r?\n/).some(line => line.split(/\s/)[0] === head)) throw Error('Push the reviewed version tag before publishing.');
  const access = JSON.parse((await command('gh', ['api', `repos/${repository}`])).stdout);
  if (!access.permissions?.push || access.private) throw Error('Public repository and publisher access are required.');
  // Existing public versions are immutable. A failed draft upload may be safely retried.
  let release;
  try { release = JSON.parse((await command('gh', ['release', 'view', tag, '--repo', repository, '--json', 'isDraft,url'])).stdout); }
  catch { /* create --verify-tag below still fails safely on access/network errors */ }
  if (release && !release.isDraft) {
    // A lost response after publication must not permanently block the queue.
    const publicRelease = JSON.parse((await command('gh', ['release', 'view', tag, '--repo', repository, '--json', 'assets,body'])).stdout);
    if (publicRelease.body?.trim() !== info.message.trim()) throw Error('Public release differs from the queued message. Inspect it before proceeding.');
    for (const name of [`Case-Forge-Setup-${info.version}.exe`, `Case-Forge-Setup-${info.version}.exe.blockmap`, 'latest.yml', 'update-messages.json', 'SHA256SUMS.txt']) {
      const bytes = await readFile(join(dist, name));
      if (!publicRelease.assets.some(a => a.name === name && a.digest === `sha256:${createHash('sha256').update(bytes).digest('hex')}`)) throw Error('Public release differs from this verified build.');
    }
    await releaseQueue.complete(root, queued.id, release.url); return { ...info, result: 'Previously published release verified; queue completed.' };
  }
  // Append every published message, not just the newest release's body. Only
  // completed public releases with actual Windows assets enter this client feed.
  const pages = JSON.parse((await command('gh', ['api', `repos/${repository}/releases?per_page=100`, '--paginate', '--slurp'])).stdout);
  const entries = pages.flat().filter(r => !r.draft && !r.prerelease && /^v\d+\.\d+\.\d+$/.test(r.tag_name) && r.assets?.some(a => a.name === 'latest.yml') && r.assets?.some(a => a.name === `Case-Forge-Setup-${r.tag_name.slice(1)}.exe`))
    .map(r => ({ id: r.tag_name, version: r.tag_name.slice(1), message: String(r.body || '').trim().slice(0, 6000) || 'Update ready.', publishedAt: r.published_at }));
  entries.push({ id: tag, version: info.version, message: info.message.trim(), publishedAt: new Date().toISOString() });
  const messages = { schema: 1, latestVersion: info.version, entries };
  require('../desktop/update-messages.cjs').validateMessages(messages, '0.0.0');
  const messageBytes = JSON.stringify(messages, null, 2) + '\n';
  if (Buffer.byteLength(messageBytes) > 8 * 1024 * 1024) throw Error('Update message history exceeds the client limit. Review retention before publishing.');
  await writeFile(join(dist, 'update-messages.json'), messageBytes);
  await verify();
  const names = [`Case-Forge-Setup-${info.version}.exe`, `Case-Forge-Setup-${info.version}.exe.blockmap`, 'latest.yml', 'update-messages.json', 'SHA256SUMS.txt', 'release-report.json'];
  // Snapshot validated assets so a concurrent desktop build cannot alter the upload.
  const staging = join(root, 'output', `release-upload-${randomBytes(8).toString('hex')}`);
  await mkdir(staging, { recursive: true });
  const report = JSON.parse(await readFile(join(dist, 'release-report.json'), 'utf8'));
  for (const name of names) {
    await copyFile(join(dist, name), join(staging, name));
    const expected = report.assets.find(asset => asset.name === name);
    if (expected && createHash('sha256').update(await readFile(join(staging, name))).digest('hex') !== expected.sha256) throw Error('Build changed during preparation. Retry after the build finishes.');
  }
  const notes = join(staging, 'message.md'); await writeFile(notes, info.message);
  if (!release) await command('gh', ['release', 'create', tag, '--repo', repository, '--verify-tag', '--draft', '--title', `Case Forge ${info.version} — Windows beta`, '--notes-file', notes]);
  else await command('gh', ['release', 'edit', tag, '--repo', repository, '--notes-file', notes]);
  await command('gh', ['release', 'upload', tag, '--repo', repository, '--clobber', ...names.map(name => join(staging, name))]);
  // GitHub's releases/tags REST route can return 404 for drafts; gh resolves the draft ID.
  const uploaded = JSON.parse((await command('gh', ['release', 'view', tag, '--repo', repository, '--json', 'assets,isDraft'])).stdout);
  if (!uploaded.isDraft) throw Error('Release became public before asset verification.');
  for (const name of names) {
    const bytes = await readFile(join(staging, name));
    const asset = uploaded.assets.find(asset => asset.name === name);
    if (!asset || asset.size !== bytes.length || asset.digest !== `sha256:${createHash('sha256').update(bytes).digest('hex')}`) throw Error('Uploaded asset verification failed. Release remains a draft.');
  }
  const latest = JSON.parse((await command('gh', ['release', 'view', '--repo', repository, '--json', 'tagName'])).stdout).tagName.replace(/^v/, '');
  if (require('../desktop/update-messages.cjs').compare(latest, info.version) >= 0) throw Error('A same or newer release is already public. Reconcile the queue before publishing.');
  await command('gh', ['release', 'edit', tag, '--repo', repository, '--draft=false', '--latest']);
  await releaseQueue.complete(root, queued.id, `https://github.com/${repository}/releases/tag/${tag}`);
  return { ...info, result: 'Release published. Online updater-enabled clients discover it on their next check. Public download and real installed-upgrade verification are still required.' };
}
export const releaseActions = {
  candidate,
  queue: () => releaseQueue.status(root),
  verify: () => withReleaseLock('verify', async () => { await verify(); return JSON.parse(await readFile(join(dist, 'release-report.json'), 'utf8')); }),
  prepare: value => withReleaseLock('prepare', () => prepare(value)),
  publish: value => withReleaseLock('publish', async () => {
    const queued = await releaseQueue.assertTurn(root, value); await releaseQueue.publishing(root, queued.id);
    try { return await publish(value); }
    catch (error) { await releaseQueue.failed(root, queued.id, error.message); throw error; }
  }),
};
export function startAdmin({ port = 0, actions = releaseActions, log = console.error } = {}) {
  const token = randomBytes(32).toString('hex'); let busy = false;
  const server = createServer(async (req, res) => {
    const origin = `http://127.0.0.1:${server.address().port}`;
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    const send = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
    if (req.headers.host !== new URL(origin).host) return send(403, { error: 'Invalid host.' });
    try {
      if (req.method === 'GET' && ['/', '/admin.js', '/admin.css'].includes(req.url)) {
        const name = req.url === '/' ? 'index.html' : req.url.slice(1);
        res.setHeader('Content-Type', name.endsWith('.html') ? 'text/html' : name.endsWith('.css') ? 'text/css' : 'text/javascript');
        return res.end(await readFile(join(root, 'scripts/release-admin', name)));
      }
      if (req.headers.authorization !== `Bearer ${token}` || (req.method !== 'GET' && req.headers.origin !== origin)) return send(403, { error: 'Open the private console link printed in your terminal.' });
      if (req.method === 'GET' && req.url === '/api/status') return send(200, await actions.candidate());
      if (req.method === 'GET' && req.url === '/api/queue') return send(200, await actions.queue());
      if (req.method !== 'POST' || !['/api/prepare', '/api/publish'].includes(req.url)) return send(404, { error: 'Not found.' });
      if (busy) return send(409, { error: 'A release operation is already running.' });
      let body = ''; for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 30000) return send(413, { error: 'Message is too large.' }); }
      const value = JSON.parse(body);
      if (req.url === '/api/publish' && value.confirm !== 'PUBLISH') return send(400, { error: 'Confirm publication first.' });
      if (busy) return send(409, { error: 'A release operation is already running.' });
      busy = true;
      try { send(200, await (req.url === '/api/prepare' ? actions.prepare(value) : actions.publish(value))); }
      finally { busy = false; }
    } catch (error) { send(400, { error: error.message }); }
  });
  server.listen(port, '127.0.0.1', () => { log(`Case Forge release admin: http://127.0.0.1:${server.address().port}/#${token}`); });
  server.requestTimeout = 30000;
  return { server, token };
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) startAdmin();
