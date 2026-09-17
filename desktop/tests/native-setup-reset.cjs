// Recovery tests use a fictional development profile, never the installed profile.
const { _electron } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { createHash } = require('node:crypto');
const assert = require('node:assert/strict');
const { PinSecurity } = require('../security.cjs');
const version = require('../package.json').version;
const root = resolve(__dirname, '../..'), output = join(root, 'output/desktop-preview');
mkdirSync(output, { recursive: true });
const profile = mkdtempSync(join(output, 'reset-profile-'));
const vault = join(profile, 'Fictional Saved Case'), verifier = join(profile, 'app-lock.json'), config = join(profile, 'config.json');
mkdirSync(vault); writeFileSync(join(vault, 'CASE-DETAILS.md'), '# Fictional Saved Case\n');
const original = join(vault, 'saved-document.txt'); writeFileSync(original, 'Fictional source preserved during PIN and app setup recovery.\r\n');
const hash = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const savedHash = hash(original);
new PinSecurity(verifier).setup('739482', '739482');
writeFileSync(config, JSON.stringify({ vault }));
const env = { ...process.env, CASEFORGE_TEST_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
let app; const passed = [];
async function launch() {
  app = await _electron.launch({ executablePath: join(root, 'desktop/node_modules/electron/dist/electron.exe'), args: [join(root, 'desktop/main.cjs')], env, cwd: root });
  const identity = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, profile: app.getPath('userData') }));
  assert.equal(identity.packaged, false); assert.equal(resolve(identity.profile), profile);
  const page = await app.firstWindow(); page.on('pageerror', e => console.error(e.message)); return page;
}
async function respond(response, checkboxChecked) {
  await app.evaluate(({ dialog }, result) => {
    dialog.showMessageBox = async (_window, options) => { process.resetDialogOptions = options; return result; };
  }, { response, checkboxChecked });
}
async function reset(page, selector) {
  const nextWindow = app.waitForEvent('window'); await page.locator(selector).click();
  const fresh = await nextWindow; await fresh.locator('#setup-configure-pin:enabled').waitFor();
  assert.deepEqual(await fresh.evaluate(() => window.strategistDesktop.getSetupState()), { pinConfigured: false, folderSelected: false, folderName: '', folderPath: '' });
  assert.equal(existsSync(verifier), false); assert.equal(JSON.parse(readFileSync(config, 'utf8')).vault, null); assert.equal(hash(original), savedHash);
  return fresh;
}
(async () => {
  try {
    let page = await launch(); await page.locator('#lock-reset-setup:enabled').waitFor();
    await page.locator('[data-app-version]').filter({ hasText: `Case Forge v${version}` }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.strategistDesktop.getAppInfo()), { name: 'Case Forge', version });
    await page.screenshot({ path: join(output, 'desktop-version-lock.png') });
    passed.push('Lock screen displays the real app version and an enabled reset control');
    const oldLock = hash(verifier), oldConfig = hash(config);
    for (const result of [{ response: 0, checkboxChecked: true }, { response: 1, checkboxChecked: false }]) {
      await respond(result.response, result.checkboxChecked); await page.locator('#lock-reset-setup').click();
      await page.locator('#lock-reset-setup:enabled').waitFor();
      assert.equal(hash(verifier), oldLock); assert.equal(hash(config), oldConfig); assert.equal(hash(original), savedHash);
    }
    const options = await app.evaluate(() => process.resetDialogOptions);
    assert.equal(options.defaultId, 0); assert.equal(options.cancelId, 0); assert.equal(options.checkboxChecked, false);
    passed.push('Cancelling or omitting the confirmation checkbox preserves PIN, setup and files');
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = () => new Promise(resolve => { process.finishResetDialog = resolve; }); });
    await page.locator('#lock-reset-setup').click();
    await app.evaluate(async () => { while (!process.finishResetDialog) await new Promise(r => setTimeout(r, 10)); });
    const lockedAgain = app.waitForEvent('window'); await app.evaluate(({ powerMonitor }) => powerMonitor.emit('lock-screen'));
    page = await lockedAgain; await page.locator('#lock-reset-setup:enabled').waitFor();
    await app.evaluate(async () => { process.finishResetDialog({ response: 1, checkboxChecked: true }); await new Promise(r => setTimeout(r, 100)); });
    assert.equal(hash(verifier), oldLock); assert.equal(hash(config), oldConfig);
    passed.push('An OS lock invalidates a pending reset confirmation');
    await respond(1, true); page = await reset(page, '#lock-reset-setup');
    await page.locator('[data-app-version]').filter({ hasText: `Case Forge v${version}` }).waitFor();
    await page.screenshot({ path: join(output, 'desktop-version-fresh-setup.png') });
    passed.push('Confirmed recovery clears PIN and remembered folder without the old PIN, keeping saved files');
    await app.close(); app = null; page = await launch(); await page.locator('#setup-configure-pin:enabled').waitFor();
    passed.push('Restart remains at fresh setup without reopening the previous case');
    await page.locator('#setup-configure-pin').click(); await page.locator('#setup-new-pin').fill('937264');
    await page.locator('#setup-confirm-pin').fill('937264'); await page.locator('#setup-save-pin').click();
    await page.locator('#setup-pin-status').filter({ hasText: 'PIN set.' }).waitFor();
    await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, vault);
    await page.locator('#setup-choose-folder').click(); await page.waitForURL('http://127.0.0.1:*/');
    await page.locator('[data-app-version]').filter({ hasText: `Case Forge v${version}` }).waitFor();
    assert.equal(hash(original), savedHash);
    assert.deepEqual(await page.evaluate(() => window.strategistDesktop.resetAppSetup()), { error: 'Access denied.' });
    passed.push('A new PIN and explicitly selected folder open the workspace with the same real version');
    const nextLock = app.waitForEvent('window'); await page.locator('#lock-app').click(); page = await nextLock;
    await page.locator('#pin').fill('739482'); await page.locator('#pin').press('Enter');
    await page.getByText('That PIN was not recognised.', { exact: false }).waitFor();
    passed.push('The previous PIN no longer unlocks the app');
    await app.close(); app = null; writeFileSync(verifier, '{damaged settings');
    page = await launch(); await page.locator('#lock-reset-setup:enabled').waitFor();
    await page.getByText('Your workspace is locked.', { exact: true }).waitFor();
    await respond(1, true); page = await reset(page, '#lock-reset-setup');
    passed.push('Explicit setup recovery also handles damaged PIN settings without deleting case files');
    await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, vault);
    await page.locator('#setup-choose-folder').click(); await page.locator('#setup-folder-status').filter({ hasText: 'Fictional Saved Case' }).waitFor();
    await respond(1, true); page = await reset(page, '#setup-reset-app');
    passed.push('Setup screen can clear a partially selected folder before a PIN is configured');
    writeFileSync(join(output, 'native-setup-reset.json'), JSON.stringify({ version, passed, profile, testedAt: new Date().toISOString() }, null, 2));
    console.log(JSON.stringify({ version, passed }, null, 2));
  } catch (error) {
    console.error(error);
    if (app) { const page = app.windows()[0]; if (page) { console.error(await page.locator('body').innerText().catch(() => '')); await page.screenshot({ path: join(output, 'native-setup-reset-error.png') }).catch(() => {}); } }
    process.exitCode = 1;
  } finally { if (app) await app.close(); }
})();
