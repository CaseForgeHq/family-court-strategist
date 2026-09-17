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
const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(new URL('../desktop/package.json', import.meta.url));
const yaml = require('js-yaml');
const repository = 'CaseForgeHq/family-court-strategist';
const dist = join(root, 'desktop/dist');
const command = (name, args) => exec(name, args, { cwd: root, windowsHide: true, timeout: 180000, maxBuffer: 2 * 1024 * 1024 });
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
  if (value.version !== info.version || value.message !== info.message || value.required !== info.required) throw Error('The prepared release changed. Review and prepare it again.');
  const status = await git(['status', '--porcelain']);
  if (status.stdout.trim()) throw Error('Commit and review the release source first. Publication is blocked while the checkout has uncommitted files.');
  const head = (await git(['rev-parse', 'HEAD'])).stdout.trim();
  if ((await git(['rev-parse', `${tag}^{commit}`])).stdout.trim() !== head) throw Error('The release tag must point to the reviewed source commit.');
  const remote = (await git(['ls-remote', 'origin', `refs/tags/${tag}`, `refs/tags/${tag}^{}`])).stdout;
  if (!remote.split(/\r?\n/).some(line => line.split(/\s/)[0] === head)) throw Error('Push the reviewed version tag before publishing.');
  const access = JSON.parse((await command('gh', ['api', `repos/${repository}`])).stdout);
  if (!access.permissions?.push || access.private) throw Error('Public repository and publisher access are required.');
  // Existing public versions are immutable. A failed draft upload may be safely retried.
  let release;
  try { release = JSON.parse((await command('gh', ['release', 'view', tag, '--repo', repository, '--json', 'isDraft,url'])).stdout); }
  catch { /* create --verify-tag below still fails safely on access/network errors */ }
  if (release && !release.isDraft) throw Error('This version is already public. Build a new version.');
  const names = [`Case-Forge-Setup-${info.version}.exe`, `Case-Forge-Setup-${info.version}.exe.blockmap`, 'latest.yml', 'SHA256SUMS.txt', 'release-report.json'];
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
  const uploaded = JSON.parse((await command('gh', ['api', `repos/${repository}/releases/tags/${tag}`])).stdout);
  for (const name of names) {
    const bytes = await readFile(join(staging, name));
    const asset = uploaded.assets.find(asset => asset.name === name);
    if (!asset || asset.size !== bytes.length || asset.digest !== `sha256:${createHash('sha256').update(bytes).digest('hex')}`) throw Error('Uploaded asset verification failed. Release remains a draft.');
  }
  await command('gh', ['release', 'edit', tag, '--repo', repository, '--draft=false', '--latest']);
  return { ...info, result: 'Release published. Online updater-enabled clients discover it on their next check. Public download and real installed-upgrade verification are still required.' };
}
export const releaseActions = {
  candidate,
  verify: () => withReleaseLock('verify', async () => { await verify(); return JSON.parse(await readFile(join(dist, 'release-report.json'), 'utf8')); }),
  prepare: value => withReleaseLock('prepare', () => prepare(value)),
  publish: value => withReleaseLock('publish', () => publish(value)),
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
