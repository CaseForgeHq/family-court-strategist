const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const { join, dirname, resolve, relative, isAbsolute } = require('node:path');
const { createHash, randomBytes } = require('node:crypto');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
async function hash(path, algorithm = 'sha256', encoding = 'hex') {
  const digest = createHash(algorithm); for await (const chunk of createReadStream(path)) digest.update(chunk); return digest.digest(encoding);
}
function safeName(name) { return typeof name === 'string' && !isAbsolute(name) && !name.includes('\\') && !name.includes(':') && !name.split('/').some(p => !p || p === '.' || p === '..'); }
function manifest(value) {
  if (value?.schema !== 1 || !/^\d+\.\d+\.\d+$/.test(value.version) || !value.engine || !value.resources) throw Error('Invalid update manifest.');
  for (const list of [value.engine, value.resources]) for (const [name, sum] of Object.entries(list))
    if (!safeName(name) || !/^[a-f0-9]{64}$/.test(sum)) throw Error('Invalid package path or digest.');
  if (!value.resources['app.asar'] || !value.resources['app/server.js']) throw Error('Incomplete app package.');
  return value;
}
async function inventory(root, dir = root) {
  const names = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isSymbolicLink()) throw Error('Links are not eligible for fast updates.');
    if (entry.isDirectory()) names.push(...await inventory(root, path));
    else names.push(relative(root, path).replaceAll('\\', '/'));
  }
  return names;
}
function compatible(current, next, version) {
  const before = current.version.split('.').map(Number), after = next.version.split('.').map(Number);
  const changed = after.findIndex((part, index) => part !== before[index]);
  return changed >= 0 && after[changed] > before[changed] && next.version === version && ['schema','electron','platform','arch','integration'].every(key => current[key] === next[key])
    && JSON.stringify(Object.entries(current.engine).sort()) === JSON.stringify(Object.entries(next.engine).sort());
}
function createFastUpdate({ resources, executable, temp, userData, electron, pid = process.pid, platform = process.platform, arch = process.arch }) {
  const root = dirname(resources);
  async function prepare({ installer, version, sha512 }) {
    if (platform !== 'win32' || arch !== 'x64') return null;
    try { if (JSON.parse(await fs.readFile(join(root, '.caseforge-fast-failed.json'))).version === version) return null; } catch {}
    const current = manifest(JSON.parse(await fs.readFile(join(resources, 'fast-update.json'), 'utf8')));
    if (current.electron !== electron || current.platform !== platform || current.arch !== arch) return null;
    // Preserve any unexpected user files rather than replacing their directory.
    const allowed = new Set([...Object.keys(current.resources), 'fast-update.json', 'app-update.yml', 'elevate.exe']);
    if ((await inventory(resources)).some(name => !allowed.has(name))) return null;
    if (!installer || !sha512 || await hash(installer, 'sha512', 'base64') !== sha512) throw Error('Installer checksum mismatch.');
    const extractor = join(resources, 'runtime', '7za.exe');
    const options = { windowsHide: true, maxBuffer: 4 * 1024 * 1024, timeout: 180000 };
    const archive = async args => { try { return await run(extractor, args, options); } catch (error) { if (error.code === 1) return error; throw error; } };
    const read = await archive(['e', '-so', installer, 'resources/fast-update.json']);
    const next = manifest(JSON.parse(read.stdout));
    if (!compatible(current, next, version)) return null;
    for (const [name, sum] of Object.entries(current.engine)) if (await hash(join(root, name)) !== sum) return null;
    const id = randomBytes(16).toString('hex'), stage = join(root, `.caseforge-stage-${id}`);
    await fs.mkdir(stage); // Same volume as resources: the final switch is a rename.
    try {
      await archive(['x', '-y', '-bd', `-o${stage}`, installer, 'resources/*']);
      const prepared = join(stage, 'resources');
      const allowedNew = new Set([...Object.keys(next.resources), 'fast-update.json', 'app-update.yml', 'elevate.exe']);
      if ((await inventory(prepared)).some(name => !allowedNew.has(name))) throw Error('Unexpected staged resource.');
      for (const [name, sum] of Object.entries(next.resources)) if (await hash(join(prepared, name)) !== sum) throw Error('Staged resource checksum mismatch.');
      // Builder adds these after afterPack. A changed provider or elevation
      // helper requires the full installer, never an unverified fast switch.
      for (const name of ['app-update.yml', 'elevate.exe']) if (await hash(join(prepared, name)) !== await hash(join(resources, name))) throw Error('Installer integration changed.');
      // Reuse the verified installer as the base of the following differential download.
      // This is done while the app remains open, never during restart.
      const sourceHelper = join(resources, 'runtime', 'CaseForgeUpdate.exe');
      const helperDir = join(temp, 'caseforge-fast', await hash(sourceHelper));
      await fs.mkdir(helperDir, { recursive: true });
      const helper = join(helperDir, 'CaseForgeUpdate.exe');
      try { if (await hash(helper) !== await hash(sourceHelper)) throw Error('Refresh helper'); }
      catch { await fs.copyFile(sourceHelper, helper); }
      const plan = { id, version, fromVersion: current.version, root, executable, userData, previousPid: pid, stage, helper, signal: join(helperDir, `ready-${id}`) };
      const planPath = join(stage, 'plan.json'); await fs.writeFile(planPath, JSON.stringify(plan));
      return { ...plan, planPath };
    } catch (error) {
      // stage is a newly-created, fixed child of this app's installation root.
      if (dirname(stage) === root && /^\.caseforge-stage-[a-f0-9]{32}$/.test(stage.slice(root.length + 1))) await fs.rm(stage, { recursive: true, force: true });
      throw error;
    }
  }
  async function launch(plan) {
    await fs.writeFile(plan.planPath, JSON.stringify(plan));
    const child = spawn(plan.helper, [executable, String(pid), plan.signal, plan.planPath], { detached: true, stdio: 'ignore', windowsHide: true });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); }); child.unref();
    const until = Date.now() + 1500;
    while (Date.now() < until) { try { await fs.access(plan.signal); return; } catch {} await new Promise(r => setTimeout(r, 20)); }
    // The original process is still alive, so the helper cannot have switched
    // files yet. Stop our own helper before allowing the full-installer fallback.
    child.kill();
    await new Promise(resolve => { if (child.exitCode !== null) resolve(); else child.once('exit', resolve); });
    throw Error('Restart helper did not become ready.');
  }
  return { prepare, launch };
}
async function markBootReady({ resources, version }) {
  const root = dirname(resources), path = join(root, '.caseforge-fast-update.json');
  try {
    const pending = JSON.parse(await fs.readFile(path, 'utf8'));
    if (!/^[a-f0-9]{32}$/.test(pending.id) || pending.version !== version) return;
    await fs.writeFile(join(root, `.caseforge-ready-${pending.id}`), JSON.stringify({ version, readyAt: Date.now() }));
  } catch { /* Ordinary launches have no update receipt. */ }
}
module.exports = { createFastUpdate, markBootReady, manifest, compatible };
