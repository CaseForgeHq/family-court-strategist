// Fictional isolated profile only. Packaged apps MUST use the read-only smoke test.
const { _electron } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { mkdirSync, writeFileSync, readFileSync, cpSync, readdirSync } = require('node:fs');
const { createHash } = require('node:crypto');
const { join, resolve } = require('node:path');
const assert = require('node:assert/strict');
const root = resolve(__dirname, '../..');
const output = join(root, 'output/desktop-preview');
const profile = join(output, `test-profile-${Date.now()}`);
const vault = join(profile, 'Example Case');
mkdirSync(profile, { recursive: true }); cpSync(join(root, 'sample-case'), vault, { recursive: true });
const executablePath = join(root, 'desktop/node_modules/electron/dist/electron.exe');
const args = [join(root, 'desktop/main.cjs')];
const env = { ...process.env, CASEFORGE_TEST_USER_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE;
let app;
const report = [];
async function launch() {
  app = await _electron.launch({ executablePath, args, env, cwd: root, timeout: 30000 });
  const info = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, profile: app.getPath('userData') }));
  assert.equal(info.packaged, false); assert.equal(resolve(info.profile), resolve(profile));
  const page = await app.firstWindow(); page.on('pageerror', (e) => console.error('PAGE ERROR', e.message)); return page;
}
async function restart() { await app.close(); app = null; return launch(); }
async function choose(page, path, canceled = false) {
  await app.evaluate(({ dialog }, value) => { dialog.showOpenDialog = async () => ({ canceled: value.canceled, filePaths: value.path ? [value.path] : [] }); }, { path, canceled });
  await page.locator('#setup-choose-folder').click();
  await page.locator('#setup-choose-folder:enabled').waitFor();
}
async function setupPin(page, pin = '739482') {
  const opensWorkspace = (await page.evaluate(() => window.strategistDesktop.getSetupState())).folderSelected;
  await page.locator('#setup-configure-pin').click(); await page.locator('#setup-new-pin').fill(pin);
  await page.locator('#setup-confirm-pin').fill(pin); await page.locator('#setup-save-pin').click();
  if (opensWorkspace) await page.waitForURL('http://127.0.0.1:*/');
  else await page.locator('#setup-pin-status').filter({ hasText: 'PIN set.' }).waitFor();
}
async function unlock(page, pin = '739482') {
  await page.locator('#pin').fill(pin); await page.locator('#pin').press('Enter');
  await page.waitForURL('http://127.0.0.1:*/', { timeout: 20000 }); await page.locator('.home-introduction').waitFor();
}
function snapshot(path) {
  return Object.fromEntries(readdirSync(path, { recursive: true, withFileTypes: true }).filter(e => e.isFile()).map(e => {
    const full = join(e.parentPath, e.name); return [full, createHash('sha256').update(readFileSync(full)).digest('hex')];
  }));
}
(async () => {
  try {
    let page = await launch(); await page.locator('#setup-configure-pin:enabled').waitFor();
    assert.match(page.url(), /setup.html$/); report.push('First run opens the two-card setup Home, with workspace gated');
    await page.screenshot({ path: join(output, 'desktop-setup-home.png') });
    await choose(page, null, true);
    assert.equal((await page.evaluate(() => window.strategistDesktop.getSetupState())).folderSelected, false);
    await choose(page, join(profile, 'missing-folder'));
    await page.getByText('That folder is unavailable.', { exact: false }).waitFor(); report.push('Cancelled and unavailable folder choices do not change setup');
    await choose(page, vault);
    assert.match((await page.evaluate(() => window.strategistDesktop.openWorkspace())).error, /Configure your PIN/);
    page = await restart(); await page.locator('#setup-folder-status').filter({ hasText: 'Example Case' }).waitFor();
    assert.match((await page.evaluate(() => window.strategistDesktop.openWorkspace())).error, /Configure your PIN/); report.push('Folder-only setup survives restart without starting case service');
    const minimisedSetup = app.waitForEvent('window');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
    page = await minimisedSetup; await page.locator('#setup-configure-pin:enabled').waitFor();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].restore());
    assert.equal(app.windows().length, 1); report.push('Minimising first-run setup preserves one gated window');
    await setupPin(page); await page.locator('.home-introduction').waitFor();
    report.push('Choosing a folder then saving a PIN opens the workspace automatically');
    page = await restart(); await page.locator('#pin-form:not([hidden])').waitFor();
    assert.deepEqual(await page.evaluate(() => window.strategistDesktop.getSetupState()), { error: 'Access denied.' });
    assert.deepEqual(await page.evaluate(() => window.strategistDesktop.resetSession({ currentPin: '739482', confirmed: true })), { error: 'Access denied.' });
    report.push('Restart requires the PIN and lock screen cannot read settings or reset');
    await unlock(page);
    const origin = new URL(page.url()).origin;
    assert.equal((await fetch(origin + '/api/case')).status, 401); report.push('Unauthenticated local requests blocked');
    assert.equal(await page.locator('.home-setup-card').count(), 2);
    await page.locator('#home-folder-status').filter({ hasText: 'Example Case' }).waitFor();
    await page.screenshot({ path: join(output, 'desktop-home.png') });
    await page.locator('[data-view="map"]').click(); await page.locator('#map-count').waitFor();
    assert.match(await page.locator('#map-count').innerText(), /[1-9]\d* recorded connection/); report.push('Case map renders recorded relationships');
    await page.locator('[data-view="documents"]').click();
    await page.locator('#document-picker').setInputFiles({ name: 'Fictional-smoke-test.txt', mimeType: 'text/plain', buffer: Buffer.from('Fictional test. Alex reported a handover on 14 September 2026. This is a test document, not a real case.') });
    await page.getByText('Ready to analyse', { exact: false }).first().waitFor({ timeout: 15000 }); report.push('Local text import and extraction');
    const { samplePdf } = await import('../../app/tests/helpers.js');
    await page.locator('#document-picker').setInputFiles({ name: 'Fictional-PDF-test.pdf', mimeType: 'application/pdf', buffer: samplePdf() });
    await page.locator('#document-detail pre').filter({ hasText: 'On 2024-03-19, Alex reported' }).waitFor({ state: 'attached', timeout: 15000 }); report.push('Native PDF worker extracts selectable text');
    await page.locator('[data-view="dashboard"]').click(); await page.locator('#home-configure-pin').click();
    await page.locator('#home-current-pin').fill('111111'); await page.locator('#home-new-pin').fill('826493'); await page.locator('#home-confirm-pin').fill('826493'); await page.locator('#home-pin-submit').click();
    await page.getByText('That PIN was not recognised.', { exact: false }).waitFor();
    await page.locator('#home-current-pin').fill('739482'); await page.locator('#home-new-pin').fill('826493'); await page.locator('#home-confirm-pin').fill('826493'); await page.locator('#home-pin-submit').click();
    await page.locator('#modal-back').waitFor({ state: 'hidden' }); report.push('Home PIN change authenticates the current PIN');
    const nextWindow = app.waitForEvent('window'); await page.locator('#lock-app').click();
    page = await nextWindow; await page.locator('#pin-form:not([hidden])').waitFor();
    await assert.rejects(fetch(origin + '/api/case')); report.push('Lock destroys renderer and closes case service');
    await page.locator('#pin').fill('739482'); await page.locator('#pin').press('Enter'); await page.getByText('That PIN was not recognised.', { exact: false }).waitFor();
    await unlock(page, '826493'); report.push('Old PIN fails and new PIN opens saved workspace');
    const resetOrigin = new URL(page.url()).origin, saved = snapshot(vault);
    await page.locator('[data-action="reset-session"]').click();
    await page.locator('#home-reset-cancel').click(); assert.equal(page.url(), resetOrigin + '/');
    await page.locator('[data-action="reset-session"]').click(); await page.locator('#reset-current-pin').fill('111111');
    await page.locator('#reset-confirm').check(); await page.locator('#home-reset-submit').click();
    await page.getByText('That PIN was not recognised.', { exact: false }).waitFor();
    assert.deepEqual(snapshot(vault), saved); report.push('Cancelled and wrong-PIN resets retain the workspace and files');
    await page.locator('#reset-current-pin').fill('826493');
    const freshWindow = app.waitForEvent('window'); await page.locator('#home-reset-submit').click();
    page = await freshWindow; await page.locator('#setup-configure-pin:enabled').waitFor();
    assert.deepEqual(await page.evaluate(() => window.strategistDesktop.getSetupState()), { pinConfigured: false, folderSelected: false, folderName: '', folderPath: '' });
    assert.deepEqual(snapshot(vault), saved); await assert.rejects(fetch(resetOrigin + '/api/case'));
    assert.equal(JSON.parse(readFileSync(join(profile, 'config.json'), 'utf8')).vault, null);
    report.push('Start fresh clears PIN and remembered folder, closes old service, preserves every saved file hash');
    await page.screenshot({ path: join(output, 'desktop-reset-home.png') });
    await setupPin(page, '937264'); page = await restart();
    await page.locator('#pin').fill('937264'); await page.locator('#pin').press('Enter'); await page.waitForURL('caseforge://lock/setup.html');
    await page.locator('#setup-configure-pin:enabled').waitFor(); report.push('PIN-only restart requires authentication then returns to setup');
    const newVault = join(profile, 'Fresh Case');
    await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }); }, newVault);
    await page.locator('#setup-create-folder').click(); await page.waitForURL('http://127.0.0.1:*/'); await page.locator('.home-introduction').waitFor();
    await page.locator('#home-folder-status').filter({ hasText: 'Fresh Case' }).waitFor();
    assert.deepEqual(snapshot(vault), saved); report.push('Fresh PIN and newly created case folder open a clean workspace');
    const minimisedWindow = app.waitForEvent('window');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
    page = await minimisedWindow; await page.locator('#pin-form:not([hidden])').waitFor();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].restore()); report.push('Minimising a configured workspace locks it');
    writeFileSync(join(output, 'native-smoke.json'), JSON.stringify({ passed: report, profile, testedAt: new Date().toISOString() }, null, 2));
    console.log(JSON.stringify({ passed: report }, null, 2));
  } catch (error) {
    console.error(error);
    if (app) { const page = app.windows()[0]; if (page) { console.error(await page.locator('body').innerText().catch(() => '')); await page.screenshot({ path: join(output, 'native-error.png') }).catch(() => {}); } }
    process.exitCode = 1;
  } finally { if (app) await app.close(); }
})();
