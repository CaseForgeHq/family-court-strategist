const { copyFileSync, existsSync, mkdtempSync } = require('node:fs');
const { join } = require('node:path');
const { spawn } = require('node:child_process');

// A tiny independent window survives Electron exiting. It never installs or
// launches anything, touches case data, or interferes with the close guard.
async function showUpdateHandoff({ runtime, temp, executable, pid, fromVersion = '', toVersion = '' }) {
  const source = join(runtime, 'CaseForgeUpdate.exe');
  if (!existsSync(source)) return;
  const folder = mkdtempSync(join(temp, 'caseforge-update-'));
  const helper = join(folder, 'CaseForgeUpdate.exe'), ready = join(folder, 'ready');
  copyFileSync(source, helper);
  const child = spawn(helper, [executable, String(pid), ready, fromVersion, toVersion], { detached: true, stdio: 'ignore', windowsHide: true });
  let failed = false;
  child.once('error', () => { failed = true; });
  child.unref();
  const deadline = Date.now() + 1500;
  while (!failed && !existsSync(ready) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
  return { pid: child.pid, shown: existsSync(ready) };
}
module.exports = { showUpdateHandoff };
