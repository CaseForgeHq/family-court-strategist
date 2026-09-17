import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, stat, mkdir, writeFile, appendFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { releaseActions, startAdmin } from '../../scripts/release-admin.mjs';
import { withReleaseLock } from '../../scripts/release-lock.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
const exec = promisify(execFile);
const repository = 'CaseForgeHq/family-court-strategist';
// MCP clients commonly forward a minimal environment. Windows package-manager discovery
// still needs executable extensions; without PATHEXT npm can resolve to its Unix shim.
const childEnv = process.platform === 'win32' ? { ...process.env,
  PATHEXT: process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD',
  ComSpec: process.env.ComSpec || join(process.env.SYSTEMROOT || 'C:\\Windows', 'System32/cmd.exe'),
  PATH: `${dirname(process.execPath)};${process.env.PATH || ''}`,
} : process.env;
const run = (command, args, options = {}) => exec(command, args, { cwd: root, env: childEnv, windowsHide: true, timeout: 180000, maxBuffer: 4 * 1024 * 1024, ...options });
let admin;
export const actions = {
  async status() {
    const candidate = await releaseActions.candidate();
    const dirty = (await run('git', ['-c', `safe.directory=${root.replaceAll('\\', '/').replace(/\/$/, '')}`, 'status', '--porcelain'])).stdout.trim();
    const installerPath = join(root, 'desktop/dist', `Case-Forge-Setup-${candidate.version}.exe`);
    const installer = await stat(installerPath).then(s => ({ path: installerPath, bytes: s.size }), () => null);
    const lastVerification = await readFile(join(root, 'desktop/dist/release-report.json'), 'utf8').then(JSON.parse, () => null);
    return { ...candidate, installer, sourceClean: !dirty, changedFileCount: dirty ? dirty.split(/\r?\n/).length : 0,
      lastVerification: lastVerification ? { version: lastVerification.version, verifiedAt: lastVerification.verifiedAt, checkedSourceFiles: lastVerification.checkedSourceFiles.length } : null,
      publicationBlockers: dirty ? ['Review and commit source, then push the matching version tag.'] : [],
      note: 'Status does not reverify binaries or contact GitHub. Use verify_release and check_publication for fresh evidence.' };
  },
  verify: releaseActions.verify,
  prepare: releaseActions.prepare,
  publish: releaseActions.publish,
  async build() {
    return withReleaseLock('build', async () => {
      const logPath = join(root, 'output/release-mcp/build.log');
      await mkdir(join(root, 'output/release-mcp'), { recursive: true }); await writeFile(logPath, `Build started ${new Date().toISOString()}\n`);
      const step = async (args, options) => {
        try { const output = await run(process.execPath, args, options); await appendFile(logPath, output.stdout + output.stderr); }
        catch (error) {
          const details = `${error.stdout || ''}\n${error.stderr || ''}`;
          await appendFile(logPath, details);
          throw Error(`Build failed. Log: ${logPath}\n${details.slice(-3500) || error.message}`);
        }
      };
      await step(['scripts/sync-brand.mjs']);
      await step(['desktop/prepare-runtime.cjs']);
      await step([join(root, 'desktop/node_modules/electron-builder/cli.js'), '--win', 'nsis', '--x64', '--publish', 'never'], { cwd: join(root, 'desktop'), timeout: 720000 });
      await step(['scripts/prepare-desktop-release.mjs']);
      return { result: 'Windows installer built and verified locally. Not published or installed.', report: JSON.parse(await readFile(join(root, 'desktop/dist/release-report.json'), 'utf8')) };
    });
  },
  async publication() {
    const permissions = JSON.parse((await run('gh', ['api', `repos/${repository}`, '--jq', '{repository:.full_name, private:.private, canPush:.permissions.push}'])).stdout);
    const releases = JSON.parse((await run('gh', ['release', 'list', '--repo', repository, '--limit', '10', '--json', 'tagName,name,isDraft,isPrerelease,publishedAt'])).stdout);
    return { ...permissions, releases, note: 'GitHub metadata only. This does not prove anonymous asset access or a real installed upgrade.' };
  },
  async openAdmin() {
    if (!admin) {
      admin = startAdmin({ log: () => {} });
      try { await once(admin.server, 'listening'); } catch (error) { admin = null; throw error; }
    }
    return { url: `http://127.0.0.1:${admin.server.address().port}/#${admin.token}`, note: 'Private owner link. Open in a browser; do not publish or save in a report. The panel runs while this MCP process is connected.' };
  },
  async close() { if (admin) { admin.server.closeAllConnections(); admin.server.close(); admin = null; } },
};
