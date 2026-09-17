const { reviewTerms } = require('./terms-helper.cjs');
// Run with PLAYWRIGHT_MODULE pointing to an installed Playwright package.
// Exercises real journal drafts and native transitions in a fictional profile.
// Only the OS folder chooser and its discard-confirmation response are stubbed.
const { _electron } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { mkdirSync, mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync } = require('node:fs');
const { createHash } = require('node:crypto');
const { join, resolve, relative } = require('node:path');
const assert = require('node:assert/strict');

const root = resolve(__dirname, '../..');
const output = join(root, 'output/desktop-preview');
mkdirSync(output, { recursive: true });
const profile = mkdtempSync(join(output, 'transition-profile-'));
const firstCase = join(profile, 'Fictional Case A');
const secondCase = join(profile, 'Fictional Case B');
for (const folder of [firstCase, secondCase]) {
  mkdirSync(folder);
  writeFileSync(join(folder, 'CASE-DETAILS.md'), `# ${relative(profile, folder)}\n\nFictional transition-test records only.\n`);
}
const env = { ...process.env, CASEFORGE_TEST_USER_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE;
const pin = '739482';
const report = [];
let app;
function observe(page) {
  // Electron's will-prevent-unload handler owns this decision. Playwright's
  // automatic dismissal can race a dialog Electron has already resolved.
  page.on('dialog', (dialog) => { if (dialog.type() !== 'beforeunload') void dialog.dismiss().catch(() => {}); });
  page.on('pageerror', (error) => console.error('PAGE ERROR', error.message));
  return page;
}

function snapshot(folder) {
  return Object.fromEntries(readdirSync(folder, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => {
    const file = join(entry.parentPath, entry.name);
    return [relative(folder, file), createHash('sha256').update(readFileSync(file)).digest('hex')];
  }));
}
async function configureDialogs(folder, discard = 0) {
  await app.evaluate(({ dialog }, value) => {
    process.caseForgeTransitionDialogs = [];
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [value.folder] });
    dialog.showMessageBoxSync = (_window, options) => {
      process.caseForgeTransitionDialogs.push({ title: options.title, message: options.message, buttons: options.buttons });
      return value.discard;
    };
  }, { folder, discard });
}
async function dialogCalls() { return app.evaluate(() => process.caseForgeTransitionDialogs || []); }
async function workingService(page) { assert.equal(await page.evaluate(async () => (await fetch('/api/case')).status), 200); }
async function noCaseService() {
  assert.equal(await app.evaluate(() => process._getActiveHandles().filter(handle => handle.constructor?.name === 'Server' && handle.listening).length), 0);
}
async function savePreferences(page, name) {
  await page.locator('#preferences-stage:not([hidden])').waitFor();
  await page.locator('#preferences-continue:enabled').waitFor();
  assert.equal(await page.locator('#preferences-case-name').inputValue(), name);
  assert.equal(await page.locator('#preferences-plan-free').isChecked(), true);
  await noCaseService();
  await page.locator('#preferences-continue').click();
  await page.locator('#ready-stage:not([hidden])').waitFor();
  assert.equal((await page.evaluate(() => window.strategistDesktop.getWorkspacePreferences())).caseName, name);
  await noCaseService();
}
async function enterReady(page) {
  await page.locator('#ready-stage:not([hidden])').waitFor();
  await reviewTerms(page); await page.locator('#ready-open:enabled').waitFor();
  await page.locator('#ready-open').click();
  await page.waitForURL('http://127.0.0.1:*/');
  await page.locator('.workspace-welcome').waitFor();
  await page.locator('[data-view="settings"]').click();
}
async function chooseFromSetupMenu(page, folder, name) {
  await configureDialogs(folder);
  await app.evaluate(async ({ Menu }) => {
    const item = Menu.getApplicationMenu().items.find(item => item.label === 'File')?.submenu?.items.find(item => item.label === 'Open case folder…');
    if (!item || !item.enabled) throw new Error('The case folder menu action is unavailable');
    await item.click();
  });
  await page.locator('#configure-stage:not([hidden])').waitFor();
  await page.locator('#setup-folder-status').filter({ hasText: name }).waitFor();
  assert.equal(await page.locator('#setup-folder-path').innerText(), folder);
  assert.equal((await page.evaluate(() => window.strategistDesktop.getSetupState())).folderPath, folder);
  await noCaseService();
}
async function journalDraft(page, title) {
  if (!await page.locator('[data-view="journal"]').isVisible()) await page.locator('.notebook-tools summary').click();
    await page.locator('[data-view="journal"]').click();
  await page.locator('#journal-new:enabled').waitFor();
  await page.locator('#journal-new').click();
  await page.locator('#journal-title').fill(title);
  await page.locator('#journal-happened').fill('Fictional unsaved account created solely for transition testing.');
}
async function minimiseOnce(page, setup = false) {
  let created = 0;
  const count = () => { created++; };
  app.on('window', count);
  try {
    const nextWindow = app.waitForEvent('window');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
    const next = observe(await nextWindow);
    await next.locator(setup ? '#setup-configure-pin:enabled' : '#pin-form:not([hidden])').waitFor();
    const windows = await app.evaluate(async ({ BrowserWindow }) => {
      // Allow queued ready-to-show/minimise events to reveal a recreation loop.
      await new Promise((done) => setTimeout(done, 350));
      return BrowserWindow.getAllWindows().map((window) => ({ minimized: window.isMinimized(), destroyed: window.isDestroyed() }));
    });
    assert.deepEqual(windows, [{ minimized: true, destroyed: false }]);
    assert.equal(created, 1, 'Minimising must create one replacement, not a window loop');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].restore());
    return next;
  } finally { app.off('window', count); }
}

(async () => {
  try {
    app = await _electron.launch({
      executablePath: join(root, 'desktop/node_modules/electron/dist/electron.exe'),
      args: [join(root, 'desktop/main.cjs')], env, cwd: root, timeout: 30000,
    });
    const identity = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, profile: app.getPath('userData') }));
    assert.equal(identity.packaged, false, 'Never enter test credentials in a packaged app');
    assert.equal(resolve(identity.profile), resolve(profile), 'Test must use its exact isolated profile');
    let page = observe(await app.firstWindow());
    await page.locator('#setup-configure-pin:enabled').waitFor();
    await configureDialogs(firstCase);
    await page.locator('#setup-choose-folder').click();
    await page.locator('#setup-folder-status').filter({ hasText: 'Fictional Case A' }).waitFor();
    await page.locator('#setup-configure-pin').click();
    await page.locator('#setup-new-pin').fill(pin);
    await page.locator('#setup-confirm-pin').fill(pin);
    await page.locator('#setup-save-pin').click();
    await page.locator('#configure-continue:enabled').waitFor();
    await page.locator('#configure-continue').click();
    await savePreferences(page, 'Fictional Case A');
    await enterReady(page);
    await workingService(page);
    report.push('Isolated setup saves local AI preferences and opens the selected fictional folder only from Ready');

    await journalDraft(page, 'Unsaved Case A draft');
    await page.locator('[data-view="settings"]').click();
    const firstOrigin = new URL(page.url()).origin;
    const originalConfig = readFileSync(join(profile, 'config.json'));
    const originalFiles = snapshot(firstCase);
    await configureDialogs(secondCase, 0);
    await page.locator('[data-action="choose-folder"]').click();
    await page.locator('#current-matter:not([aria-busy])').waitFor();
    const kept = await dialogCalls();
    assert.equal(kept.length, 1);
    assert.match(kept[0].message, /unsaved work/i);
    assert.deepEqual(kept[0].buttons, ['Keep working', 'Discard edits and switch']);
    assert.equal(page.url(), firstOrigin + '/');
    assert.deepEqual(readFileSync(join(profile, 'config.json')), originalConfig);
    assert.equal((await page.evaluate(() => window.strategistDesktop.getSetupState())).folderPath, firstCase);
    await workingService(page);
    if (!await page.locator('[data-view="journal"]').isVisible()) await page.locator('.notebook-tools summary').click();
    await page.locator('[data-view="journal"]').click();
    assert.equal(await page.locator('#journal-title').inputValue(), 'Unsaved Case A draft');
    assert.deepEqual(snapshot(firstCase), originalFiles);
    report.push('Cancelled unsaved-folder switch keeps origin, folder, settings, service and journal draft');

    await page.locator('[data-view="settings"]').click();
    await configureDialogs(secondCase, 1);
    await page.locator('[data-action="choose-folder"]').click();
    await page.waitForURL('caseforge://lock/setup.html');
    await savePreferences(page, 'Fictional Case B');
    await enterReady(page);
    await page.waitForURL((url) => url.protocol === 'http:' && url.origin !== firstOrigin, { timeout: 20000 });
    await page.locator('.home-setup-cards').waitFor();
    await page.locator('#home-folder-status').filter({ hasText: 'Fictional Case B' }).waitFor();
    await page.screenshot({ path: join(output, 'desktop-home-final.png') });
    assert.equal((await dialogCalls()).length, 1);
    assert.equal(JSON.parse(readFileSync(join(profile, 'config.json'), 'utf8')).vault, secondCase);
    await workingService(page);
    await assert.rejects(fetch(firstOrigin + '/api/case', { signal: AbortSignal.timeout(5000) }));
    if (!await page.locator('[data-view="journal"]').isVisible()) await page.locator('.notebook-tools summary').click();
    await page.locator('[data-view="journal"]').click();
    await page.getByText('No journal entries yet.', { exact: false }).waitFor();
    assert.equal(await page.locator('#journal-form').count(), 0);
    assert.deepEqual(snapshot(firstCase), originalFiles);
    report.push('Confirmed discard opens new folder, closes old service and drops only the unsaved draft');

    page = await minimiseOnce(page);
    await page.locator('#pin').fill(pin);
    await page.locator('#pin').press('Enter');
    await page.waitForURL('caseforge://lock/setup.html');
    await page.locator('#preferences-stage:not([hidden])').waitFor();
    await page.locator('#preferences-continue:enabled').click();
    await page.locator('#ready-stage:not([hidden])').waitFor();
    assert.equal((await page.evaluate(() => window.strategistDesktop.getWorkspacePreferences())).caseName, 'Fictional Case B');
    await noCaseService();
    await chooseFromSetupMenu(page, firstCase, 'Fictional Case A');
    await page.locator('#configure-continue').click();
    await savePreferences(page, 'Fictional Case A');
    await chooseFromSetupMenu(page, secondCase, 'Fictional Case B');
    await page.locator('#configure-continue').click();
    await savePreferences(page, 'Fictional Case B');
    report.push('Choosing a folder from the native menu at Ready refreshes setup and the displayed folder before entry');
    await enterReady(page);
    await page.locator('#home-folder-status').filter({ hasText: 'Fictional Case B' }).waitFor();
    report.push('Configured-workspace minimise leaves one locked window and reopens the selected case');

    await journalDraft(page, 'Saved Case B entry');
    await page.getByRole('button', { name: 'Save entry', exact: true }).click();
    await page.getByText('Saved locally. Your account has not been added to verified facts or sent to AI.', { exact: true }).waitFor();
    const savedFiles = snapshot(secondCase);
    await journalDraft(page, 'Unsaved reset draft');
    await page.locator('[data-view="settings"]').click();
    await page.locator('[data-action="reset-session"]').click();
    await page.locator('#home-reset-cancel').click();
    await page.locator('#modal-back').waitFor({ state: 'hidden' });
    if (!await page.locator('[data-view="journal"]').isVisible()) await page.locator('.notebook-tools summary').click();
    await page.locator('[data-view="journal"]').click();
    assert.equal(await page.locator('#journal-title').inputValue(), 'Unsaved reset draft');
    await workingService(page);
    report.push('Cancelled Start fresh preserves the unsaved journal draft and live service');

    await page.locator('[data-view="settings"]').click();
    await page.locator('[data-action="reset-session"]').click();
    await page.locator('#reset-current-pin').fill(pin);
    await page.locator('#reset-confirm').check();
    const resetOrigin = new URL(page.url()).origin;
    const oldPage = page;
    const resetWindow = app.waitForEvent('window');
    await page.locator('#home-reset-submit').click();
    page = observe(await resetWindow);
    await page.locator('#setup-configure-pin:enabled').waitFor();
    assert.equal(oldPage.isClosed(), true);
    assert.equal(app.windows().length, 1);
    assert.deepEqual(await page.evaluate(() => window.strategistDesktop.getSetupState()), { pinConfigured: false, folderSelected: false, folderName: '', folderPath: '' });
    assert.equal(existsSync(join(profile, 'app-lock.json')), false);
    assert.equal(existsSync(join(profile, 'workspace-preferences.json')), false);
    assert.equal(JSON.parse(readFileSync(join(profile, 'config.json'), 'utf8')).vault, null);
    assert.deepEqual(snapshot(firstCase), originalFiles);
    assert.deepEqual(snapshot(secondCase), savedFiles);
    await assert.rejects(fetch(resetOrigin + '/api/case', { signal: AbortSignal.timeout(5000) }));
    report.push('Confirmed Start fresh destroys the unsaved renderer while preserving both case folders and saved journal');

    page = await minimiseOnce(page, true);
    assert.equal((await page.evaluate(() => window.strategistDesktop.getSetupState())).pinConfigured, false);
    report.push('Fresh setup minimise leaves one gated window without a recreation loop');
    await page.screenshot({ path: join(output, 'native-transitions-final.png') });
    writeFileSync(join(output, 'native-transitions.json'), JSON.stringify({ passed: report, profile, testedAt: new Date().toISOString() }, null, 2));
    console.log(JSON.stringify({ passed: report, profile }, null, 2));
  } catch (error) {
    console.error(error);
    if (app) {
      const page = app.windows()[0];
      if (page) {
        console.error(await page.locator('body').innerText().catch(() => ''));
        await page.screenshot({ path: join(output, 'native-transitions-error.png') }).catch(() => {});
      }
    }
    process.exitCode = 1;
  } finally { if (app) await app.close(); }
})();
