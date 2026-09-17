const { reviewTerms } = require('./terms-helper.cjs');
// Real Electron flow, unique development profile, fictional files and stubbed native dialogs.
const { _electron } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { mkdtempSync, mkdirSync, rmdirSync, writeFileSync, readFileSync, existsSync, copyFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const assert = require('node:assert/strict');
const version = require('../package.json').version;
const root = resolve(__dirname, '../..'), output = join(root, 'output/desktop-preview');
mkdirSync(output, { recursive: true });
const profile = mkdtempSync(join(output, 'onboarding-profile-')), folder = join(profile, 'Fictional Case');
mkdirSync(folder); writeFileSync(join(folder, 'CASE-DETAILS.md'), '# Fictional Case\n\nTest only.');
const evidence = 'Fictional evidence must survive app setup reset.';
writeFileSync(join(folder, 'evidence.txt'), evidence);
writeFileSync(join(profile, 'scene-preferences.json'), JSON.stringify({ cityId: 'brisbane', weatherEnabled: true }));
if (existsSync(join(output, 'weather-live-cache.json'))) copyFileSync(join(output, 'weather-live-cache.json'), join(profile, 'weather-cache.json'));
const env = { ...process.env, CASEFORGE_TEST_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
const pin = '739482', passed = [], layouts = [], errors = [], confirmations = []; let app, page;
async function servers() { return app.evaluate(() => process._getActiveHandles().filter((h) => h.constructor?.name === 'Server' && h.listening).length); }
async function capture(name, width = 1320, height = 880) {
  await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(...size), [width, height]);
  await page.waitForFunction((size) => innerWidth === size[0] && innerHeight === size[1], [width, height]);
  await page.evaluate(async () => {
    await document.fonts.ready; await new Promise(requestAnimationFrame);
    await Promise.all(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})));
  });
  const report = await page.evaluate(() => {
    const bounds = (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
    const visible = (el) => el.checkVisibility();
    const progress = document.querySelector('main > .setup-progress');
    const indicator = getComputedStyle(progress, '::before');
    const controls = Array.from(document.querySelectorAll('button,input')).filter(el => visible(el) && !el.closest('.plans-experience')).map(el => ({ id: el.id, ...bounds(el) }));
    return { stage: document.body.dataset.entryStage, viewport: [innerWidth, innerHeight], scrollWidth: document.documentElement.scrollWidth,
      controls, progress: bounds(document.querySelector('main > .setup-progress')), stageBounds: bounds(document.getElementById(document.body.dataset.entryStage + '-stage')), cards: Array.from(document.querySelectorAll('.entry-card')).filter(visible).map(bounds),
      navigation: Array.from(document.querySelectorAll('.stage-navigation')).filter(visible).map(bounds),
      steps: Array.from(document.querySelectorAll('.setup-progress li')).map(bounds),
      indicator: { x:bounds(progress).x + new DOMMatrixReadOnly(indicator.transform).m41, width:parseFloat(indicator.width), transition:indicator.transitionDuration },
      headings: Array.from(document.querySelectorAll('.entry-card h2')).filter(visible).map(bounds),
      primary: ['pin', 'lock-choose-folder', 'setup-configure-pin', 'setup-choose-folder'].map(id => document.getElementById(id)).filter(el => el && visible(el)).map(bounds),
      fonts: [getComputedStyle(document.body).fontFamily, getComputedStyle(document.querySelector('h1,h2')).fontFamily] };
  });
  layouts.push({ name, ...report });
  await page.screenshot({ path: join(output, `onboarding-${name}-${width}x${height}.png`) });
  assert.deepEqual(report.viewport, [width,height], `${name}: requested native viewport must stay stable`);
  assert.ok(report.scrollWidth <= width, `${name}: horizontal overflow (${report.scrollWidth} > ${width})`);
  for (const control of report.controls) assert.ok(control.x >= 0 && control.y >= 0 && control.right <= width + 1 && control.bottom <= height + 1, `${name}: ${control.id} outside viewport ${JSON.stringify(control)}`);
  assert.ok(Math.abs(report.progress.x + report.progress.width / 2 - width / 2) <= 1, `${name}: progress must be centered`);
  for (const edge of ['x','width']) assert.ok(Math.abs(report.progress[edge] - report.stageBounds[edge]) <= 1, `${name}: progress spans the full section ${edge}`);
  for (const step of report.steps) assert.ok(Math.abs(step.width - report.progress.width / 3) <= 1, `${name}: steps divide the full row equally`);
  const selected = report.steps[['configure','preferences','ready'].indexOf(report.stage)];
  for (const edge of ['x','width']) assert.ok(Math.abs(report.indicator[edge] - selected[edge]) <= 1, `${name}: highlight aligns with the active step ${edge}`);
  assert.ok(report.progress.bottom <= report.stageBounds.y, `${name}: progress must sit above the visible stage`);
  if (report.cards.length === 2) {
    for (const field of ['y','width','height','bottom']) assert.ok(Math.abs(report.cards[0][field] - report.cards[1][field]) <= .5, `${name}: aligned card ${field}`);
    assert.ok(report.cards[0].right < report.cards[1].x);
    assert.ok(Math.abs(report.headings[0].y - report.headings[1].y) <= .5);
    for (const field of ['y','width','height']) assert.ok(Math.abs(report.primary[0][field] - report.primary[1][field]) <= .5, `${name}: aligned primary ${field}`);
  }
  assert.match(report.fonts[0], /Quicksand/); assert.match(report.fonts[1], /Ubuntu/);
}
function observe(target) { target.on('pageerror', e => errors.push(e.message)); return target; }
async function stage(name) { await page.locator(`#${name}-stage`).waitFor(); assert.equal(await page.locator(`[data-step="${name}"]`).getAttribute('aria-current'), 'step'); }
async function recordConfirmation(target) {
  await target.exposeFunction('recordVerifiedState', (state) => confirmations.push(state));
  await target.evaluate(() => window.strategistDesktop.onPinVerified(async () => {
    const denied = await window.strategistDesktop.getSetupState();
    await window.recordVerifiedState({ status: document.getElementById('lock-pin-card').dataset.status, label: document.getElementById('lock-pin-state').textContent, denied, url: location.href }).catch(() => {});
  }));
}
(async () => {
  try {
    app = await _electron.launch({ executablePath: join(root, 'desktop/node_modules/electron/dist/electron.exe'), args: [join(root, 'desktop/main.cjs')], env, cwd: root, timeout: 30000 });
    const identity = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, profile: app.getPath('userData') }));
    assert.equal(identity.packaged, false); assert.equal(resolve(identity.profile), profile);
    page = observe(await app.firstWindow());
    await stage('configure'); await page.locator('#scene-timezone:enabled').waitFor({ state: 'attached' });
    assert.equal(await page.locator('#welcome-continue, #welcome-stage, footer .entry-brand, footer .setup-progress').count(), 0);
    assert.equal(await page.locator('body > header .entry-brand img').count(), 1);
    assert.equal(await page.locator('main > .setup-progress').count(), 1);
    assert.equal(await page.locator('#scene-panel').isVisible(), false);
    assert.equal(await page.locator('#scene-toggle').getAttribute('aria-expanded'), 'false');
    await page.waitForFunction(() => !document.getElementById('scene-weather-status').textContent.includes('Loading'));
    assert.equal(await page.locator('#scene-city-label').textContent(), 'Brisbane');
    assert.ok((await page.locator('footer').innerText()).includes(`Case Forge v${version}`));
    assert.match(await page.locator('footer').innerText(), /Beta/);
    assert.equal(await servers(), 0);
    await capture('direct-start'); await capture('direct-start-compact', 820, 650);
    await page.locator('#scene-toggle').click(); await page.locator('#scene-panel').waitFor();
    assert.equal(await page.locator('#scene-toggle').getAttribute('aria-expanded'), 'true');
    await capture('weather-panel', 820, 650);
    await page.locator('#scene-close').click(); await page.locator('#scene-panel').waitFor({ state: 'hidden' });
    await page.locator('#scene-toggle').click(); await page.keyboard.press('Escape');
    await page.locator('#scene-panel').waitFor({ state: 'hidden' });
    await page.locator('#scene-toggle').click();
    await page.locator('#scene-weather-toggle').uncheck();
    await page.locator('#scene-weather-status').filter({ hasText: 'Weather off' }).waitFor();
    await page.locator('#scene-timezone').fill('0'); await page.locator('#scene-timezone').dispatchEvent('change');
    await page.waitForFunction(() => window.CaseForgeScene.getTimezone() === 'America/Los_Angeles');
    await page.waitForFunction(async () => (await window.strategistDesktop.getScenePreferences()).cityId === 'los-angeles');
    await page.locator('#scene-timezone').fill('7'); await page.locator('#scene-timezone').dispatchEvent('change');
    await page.waitForFunction(async () => (await window.strategistDesktop.getScenePreferences()).cityId === 'brisbane');
    await page.locator('#pin-heading').click(); await page.locator('#scene-panel').waitFor({ state: 'hidden' });
    passed.push('Startup immediately shows PIN and folder cards with the logo at the top and centered progress above the cards; weather tab opens/closes with button, Escape and outside click; timezone and weather preferences persist');
    assert.equal(await page.locator('#configure-continue').isEnabled(), false);
    assert.match(await page.locator('#configure-stage').innerText(), /Select once, you can change later in settings\./);
    await capture('configure-empty', 820, 650); await capture('configure-day');
    await page.locator('#setup-configure-pin').click(); await page.locator('#pin-dialog[open]').waitFor();
    await capture('pin-dialog', 820, 650);
    await page.locator('#setup-new-pin').fill(pin); await page.locator('#setup-confirm-pin').fill(pin); await page.locator('#setup-save-pin').click();
    await page.locator('#pin-dialog').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('#setup-pin-badge').innerText(), 'PIN active');
    await page.locator('#setup-configure-pin').click();
    await capture('change-pin-dialog', 820, 650);
    assert.equal(await page.locator('#setup-save-pin').isEnabled(), false);
    await page.locator('#setup-cancel-pin').click();
    assert.equal(await page.locator('#configure-continue').isEnabled(), false); assert.equal(await servers(), 0);
    await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, folder);
    await page.locator('#setup-choose-folder').click(); await page.locator('#configure-continue:enabled').waitFor();
    await stage('configure'); assert.equal(await servers(), 0);
    await capture('configure-complete', 820, 650);
    assert.match((await page.evaluate(() => window.strategistDesktop.openWorkspace())).error, /preferences/);
    await page.locator('#configure-continue').click(); await stage('preferences');
    await page.locator('#preferences-continue:enabled').waitFor();
    assert.equal(await page.locator('#preferences-case-name').inputValue(), 'Fictional Case');
    assert.equal(await page.locator('#preferences-plan-free').isChecked(), true);
    assert.equal(await page.locator('#setup-progress-fill').evaluate(el => el.style.width), '50%');
    assert.equal(await servers(), 0);
    await capture('preferences', 820, 650); await capture('preferences-minimum-window', 804, 619); await capture('preferences');
    const [firstRelock] = await Promise.all([
      app.waitForEvent('window'),
      page.evaluate(() => window.strategistDesktop.lock()).catch((error) => { if (!/has been closed/.test(error.message)) throw error; }),
    ]);
    page = observe(firstRelock);
    await recordConfirmation(page);
    await page.locator('#pin').fill('73');
    assert.equal(await page.locator('#lock-pin-card').getAttribute('data-status'), 'active');
    await capture('pin-typing', 820, 650);
    await page.locator('#pin').fill(pin);
    assert.equal(await page.locator('#lock-pin-card').getAttribute('data-status'), 'ready');
    assert.equal(await page.locator('#lock-pin-state').innerText(), 'PIN active');
    await capture('pin-ready', 820, 650);
    await page.locator('#pin').fill(pin); await page.locator('#pin').press('Enter');
    await page.waitForURL('caseforge://lock/setup.html'); await stage('preferences');
    await page.locator('#preferences-continue:enabled').waitFor();
    assert.deepEqual(confirmations, [{ status: 'success', label: 'PIN confirmed', denied: { error: 'Access denied.' }, url: 'caseforge://lock/lock.html' }]);
    assert.equal(await servers(), 0);
    await page.locator('#preferences-case-name').fill('Family records');
    await page.locator('label[data-plan="plus"]').click();
    await page.locator('.astra-option').click();
    const beforePreferenceSave = await page.evaluate(() => window.strategistDesktop.getWorkspacePreferences());
    assert.equal(beforePreferenceSave.configured, false);
    assert.match((await page.evaluate(() => window.strategistDesktop.saveWorkspacePreferences({ folderKey: 'wrong-folder', caseName: 'Wrong case', preferredProvider: 'ollama' }))).error, /folder changed/);
    assert.equal((await page.evaluate(() => window.strategistDesktop.getWorkspacePreferences())).configured, false);
    await page.locator('#preferences-continue').click(); await stage('ready');
    assert.equal(await servers(), 0);
    await capture('ready', 820, 650); await capture('ready');
    passed.push('Three-page setup saves case name and AI preference, rejects stale folder saves, and requires Preferences before Ready; no case server starts before entry');
    await reviewTerms(page); await page.locator('#ready-open').click(); await page.waitForURL('http://127.0.0.1:*/'); await page.locator('.workspace-welcome').waitFor();
    const origin = new URL(page.url()).origin;
    assert.ok(await servers()); assert.equal(await page.evaluate(async () => (await fetch('/api/case')).status), 200);
    const openedCase = await page.evaluate(async () => ({ session: await (await fetch('/api/session')).json(), case: await (await fetch('/api/case')).json() }));
    assert.equal(openedCase.case.caseName, 'Family records');
    assert.equal(openedCase.session.workspacePreferences.preferredProvider, 'ollama');
    assert.equal(openedCase.session.workspacePreferences.aiPlan, 'everyday');
    assert.equal(openedCase.session.workspacePreferences.advancedIntelligence, true);
    assert.equal(openedCase.session.connection, null);
    const replacement = app.waitForEvent('window'); await page.locator('#lock-app').click(); page = observe(await replacement); await stage('configure');
    assert.equal(await servers(), 0); await assert.rejects(fetch(origin + '/api/case', { signal: AbortSignal.timeout(3000) }));
    assert.deepEqual(await page.evaluate(() => window.strategistDesktop.getSetupState()), { error: 'Access denied.' });
    assert.deepEqual(await page.evaluate(() => window.strategistDesktop.getWorkspacePreferences()), { error: 'Access denied.' });
    assert.deepEqual(await page.evaluate(() => window.strategistDesktop.saveWorkspacePreferences({})), { error: 'Access denied.' });
    assert.equal(await page.evaluate(() => window.strategistDesktop.chooseCaseFolder()), false);
    assert.equal((await page.locator('body').innerText()).includes(folder), false);
    await page.waitForFunction(() => document.activeElement.id === 'pin');
    await page.locator('#pin').fill('123'); await page.locator('#scene-toggle').click();
    await page.keyboard.press('Escape'); assert.equal(await page.locator('#pin').inputValue(), '123');
    assert.equal(await servers(), 0);
    await capture('lock-day');
    await page.evaluate(() => { window.CaseForgeScene.setWeather({ condition: 'rain', cloudCover: .9, precipitation: 3 }); window.CaseForgeScene.update(new Date('2026-09-16T12:00:00Z')); });
    await capture('lock-night-rain');
    assert.equal(await page.locator('html').getAttribute('data-scene-mode'), 'dark');
    assert.equal(await page.locator('html').getAttribute('data-weather'), 'rain');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await page.locator('.weather-rain-motion').evaluate(el => getComputedStyle(el).animationName), 'none');
    await page.locator('#pin').fill('999999'); await page.locator('#pin').press('Enter');
    await page.locator('#lock-message').filter({ hasText: 'not recognised' }).waitFor(); assert.equal(await servers(), 0);
    assert.equal(await page.locator('#lock-pin-card').getAttribute('data-status'), 'error');
    await capture('pin-error', 820, 650);
    await page.locator('#pin').fill(pin); await page.locator('#pin').press('Enter'); await page.waitForURL('caseforge://lock/setup.html'); await stage('preferences');
    assert.equal(await servers(), 0);
    passed.push('Relock closes the case service, hides case paths and denies folder access; incorrect PIN stays locked and correct PIN reaches Preferences');
    assert.equal(await page.locator('#preferences-case-name').inputValue(), 'Family records');
    assert.equal(await page.locator('#preferences-plan-everyday').isChecked(), true);
    assert.equal(await page.locator('#preferences-astra').isChecked(), true);
    await page.locator('#preferences-back').click(); await stage('configure');
    await app.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] }); });
    await page.locator('#setup-choose-folder').click(); await page.locator('#configure-continue:enabled').waitFor();
    assert.equal((await page.evaluate(() => window.strategistDesktop.getSetupState())).folderPath, folder);
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: true }); });
    const blockedTemp = join(profile, 'workspace-preferences.json.tmp');
    mkdirSync(blockedTemp);
    assert.ok((await page.evaluate(() => window.strategistDesktop.resetAppSetup())).error);
    assert.equal(JSON.parse(readFileSync(join(profile, 'config.json'), 'utf8')).vault, folder);
    assert.equal((await page.evaluate(() => window.strategistDesktop.getSetupState())).pinConfigured, true);
    assert.equal((await page.evaluate(() => window.strategistDesktop.getWorkspacePreferences())).caseName, 'Family records');
    rmdirSync(blockedTemp);
    const reset = app.waitForEvent('window'); await page.locator('#setup-reset-app').click(); page = observe(await reset); await stage('configure');
    assert.deepEqual(await page.evaluate(() => window.strategistDesktop.getSetupState()), { pinConfigured: false, folderSelected: false, folderName: '', folderPath: '' });
    assert.equal(readFileSync(join(folder, 'evidence.txt'), 'utf8'), evidence); assert.equal(await servers(), 0);
    assert.equal(existsSync(join(profile, 'workspace-preferences.json')), false);
    const stable = layouts.filter(item => ['configure-complete','preferences','ready'].includes(item.name) && item.viewport[0] === 820);
    assert.equal(stable.length, 3);
    for (const item of stable) {
      assert.ok(Math.abs(item.progress.y - stable[0].progress.y) < .5, 'Progress must not jump between setup pages');
      assert.ok(Math.abs(item.navigation[0].y - stable[0].navigation[0].y) < .5, 'Navigation must keep its position between setup pages');
    }
    assert.deepEqual(errors, []);
    passed.push('Typing, ready and error states remain distinct from native confirmation; verified feedback precedes access; compact PIN editing fits and progress/navigation stay fixed across all three pages');
    passed.push('Cancelling folder choice preserves selection; confirmed reset clears PIN/setup, returns directly to the two cards and preserves all saved evidence');
    console.log(JSON.stringify({ passed, layouts: layouts.length, profile }, null, 2));
  } catch (error) { console.error(error); if (page && !page.isClosed()) await page.screenshot({ path: join(output, 'onboarding-error.png') }).catch(() => {}); process.exitCode = 1; }
  finally { writeFileSync(join(output, 'native-onboarding.json'), JSON.stringify({ passed, layouts, errors, confirmations, profile, testedAt: new Date().toISOString() }, null, 2)); if (app) await app.close(); }
})();
