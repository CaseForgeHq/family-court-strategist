// Native UI and acceptance flow, with a fictional case and an isolated profile.
const { _electron } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } = require('node:fs');
const { join, resolve } = require('node:path');
const assert = require('node:assert/strict');
const { PinSecurity } = require('../security.cjs');
const { createWorkspacePreferences } = require('../workspace-preferences.cjs');
const { reviewTerms } = require('./terms-helper.cjs');
const root = resolve(__dirname, '../..'), output = join(root, 'output/desktop-preview');
const version = require('../package.json').version;
mkdirSync(output, { recursive: true });
const profile = mkdtempSync(join(output, 'terms-profile-')), folder = join(profile, 'Fictional Case');
mkdirSync(folder); writeFileSync(join(folder, 'CASE-DETAILS.md'), '# Fictional Case\n\nAcceptance test only.');
writeFileSync(join(profile, 'config.json'), JSON.stringify({ vault: folder }));
writeFileSync(join(profile, 'scene-preferences.json'), JSON.stringify({ cityId: 'brisbane', weatherEnabled: false }));
const pin = '739482'; new PinSecurity(join(profile, 'app-lock.json')).setup(pin, pin);
createWorkspacePreferences(join(profile, 'workspace-preferences.json')).set(folder, { caseName: 'Fictional Case', preferredProvider: 'ollama', aiPlan: 'free', advancedIntelligence: false });
const env = { ...process.env, CASEFORGE_TEST_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
const layouts = [], errors = [], failedAssets = [], passed = [];
let app, page;
const receiptPath = join(profile, 'terms-acceptance.json');
async function start() {
  app = await _electron.launch({ executablePath: join(root, 'desktop/node_modules/electron/dist/electron.exe'), args: [join(root, 'desktop/main.cjs')], env, cwd: root, timeout: 30000 });
  assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), profile);
  page = await app.firstWindow(); observe(page);
  await page.locator('#pin:enabled').waitFor();
}
function observe(target) {
  target.on('pageerror', error => errors.push(error.message));
  target.on('response', response => { if (response.status() >= 400 && !response.url().includes('/api/')) failedAssets.push(response.url()); });
}
async function unlock() {
  await page.locator('#pin').fill(pin); await page.locator('#pin').press('Enter');
  await page.locator('#preferences-stage:not([hidden])').waitFor();
  await page.locator('#preferences-continue:enabled').waitFor();
  assert.equal(await page.locator('#ready-stage').isVisible(), false, 'Saved preferences must not skip page 02');
  assert.equal(await page.locator('#preferences-case-name').inputValue(), 'Fictional Case');
  await page.locator('#preferences-continue').click();
  await page.locator('#ready-stage:not([hidden])').waitFor();
}
async function capture(name, width, height, hour) {
  await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(...size), [width, height]);
  await page.waitForFunction(size => innerWidth === size[0] && innerHeight === size[1], [width, height]);
  await page.evaluate(async hour => {
    window.CaseForgeScene.update(new Date(`2026-09-16T${hour}:00:00+10:00`));
    await document.fonts.ready;
    await Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity).map(a => a.finished.catch(() => {})));
  }, hour);
  const layout = await page.evaluate(() => {
    const bounds = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
    const reader = document.getElementById('terms-reader');
    return { width: innerWidth, height: innerHeight, pageWidth: document.documentElement.scrollWidth, pageHeight: document.documentElement.scrollHeight, progress: bounds('.setup-progress'), panel: bounds('.terms-glass'), reader: bounds('#terms-reader'), scrollHeight: reader.scrollHeight, scrollWidth: reader.scrollWidth, clientWidth: reader.clientWidth, mode: document.documentElement.dataset.sceneMode, fontSize: getComputedStyle(reader).fontSize, controls: ['#ready-back', '.terms-agreement', '#ready-open', '.entry-footer', '.entry-header'].map(bounds) };
  });
  layouts.push({ name, ...layout });
  assert.ok(layout.pageWidth <= width + 1 && layout.pageHeight <= height + 1, `${name}: outer page must not scroll`);
  for (const key of ['x', 'width']) assert.ok(Math.abs(layout.progress[key] - layout.panel[key]) <= 1, `${name}: terms panel spans progress width`);
  assert.ok(layout.scrollHeight > layout.reader.height + 100, `${name}: only the terms are scrollable`);
  assert.ok(layout.reader.height >= 130, `${name}: useful reading area`);
  assert.ok(layout.scrollWidth <= layout.clientWidth, `${name}: no horizontal text scrolling`);
  assert.ok(parseFloat(layout.fontSize) >= 13, `${name}: readable text`);
  for (const control of layout.controls) assert.ok(control.x >= 0 && control.y >= 0 && control.right <= width + 1 && control.bottom <= height + 1, `${name}: actions remain in view`);
  await page.screenshot({ path: join(output, `terms-${version}-${name}.png`) });
}
(async () => {
  try {
    await start();
    assert.deepEqual(await page.evaluate(() => window.strategistDesktop.getTermsStatus()), { error: 'Access denied.' });
    assert.deepEqual(await page.evaluate(() => window.strategistDesktop.acceptTerms({ accepted: true })), { error: 'Access denied.' });
    await unlock();
    assert.equal((await page.locator('[data-step="ready"]').innerText()).replace(/\s+/g, ' '), '03 Terms');
    assert.equal(await page.locator('#ready-open').isDisabled(), true);
    assert.equal(await page.locator('#terms-agree').isDisabled(), true);
    assert.equal(await page.locator('#ready-open').isVisible(), false);
    assert.equal(await page.locator('.terms-agreement').isVisible(), false);
    assert.match(await page.locator('#terms-scroll-status').innerText(), /Scroll to the end/);
    passed.push('Returning PIN entry shows saved Preferences before Terms; agreement controls start hidden');
    assert.equal(existsSync(receiptPath), false);
    assert.match((await page.evaluate(() => window.strategistDesktop.openWorkspace())).error, /terms/);
    const status = await page.evaluate(() => window.strategistDesktop.getTermsStatus());
    assert.match((await page.evaluate(value => window.strategistDesktop.acceptTerms(value), { ...status, accepted: true, version: 'old' })).error, /current beta terms/);
    assert.equal(await app.evaluate(() => process._getActiveHandles().filter(h => h.constructor?.name === 'Server' && h.listening).length), 0);
    passed.push('Locked callers are denied; missing and stale acceptance cannot start the case service');
    for (const [label, width, height] of [['full', 1304, 841], ['compact', 1000, 720], ['minimum', 804, 619]]) {
      for (const [mode, hour] of [['day', '12'], ['night', '22']]) await capture(`${label}-${mode}`, width, height, hour);
      assert.equal(await page.locator('#ready-open').isVisible(), false, 'Resizing must not reveal agreement');
      assert.equal(await page.locator('.terms-agreement').isVisible(), false);
    }
    await page.locator('.terms-glass').hover({ position: { x: 40, y: 80 } });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const hover = await page.locator('.terms-glass').evaluate(el => ({ active: el.getAttribute('data-glass-active'), glow: getComputedStyle(el, '::after').display, transform: getComputedStyle(el, '::before').transform }));
    assert.deepEqual(hover, { active: null, glow: 'none', transform: 'none' });
    passed.push('Terms remain steady without pointer glow or tilt; resizing cannot count as reading');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.locator('#terms-reader').focus(); await page.locator('#terms-reader').press('PageDown');
    await page.waitForFunction(() => document.getElementById('terms-reader').scrollTop > 0);
    assert.equal(await page.locator('#terms-agree').isDisabled(), true);
    assert.equal(await page.locator('#ready-open').isVisible(), false);
    await page.locator('#terms-reader').press('Control+End');
    await page.locator('#terms-agree:enabled').waitFor();
    assert.equal(await page.locator('.terms-agreement').isVisible(), true);
    assert.equal(await page.locator('#ready-open').isVisible(), true);
    assert.equal(await page.locator('#ready-open').isDisabled(), true);
    await capture('end-night', 1304, 841, '22');
    await reviewTerms(page);
    await page.locator('#terms-agree').uncheck(); assert.equal(await page.locator('#ready-open').isDisabled(), true);
    await page.locator('#terms-agree').check();
    await page.locator('#ready-back').click(); await page.locator('#preferences-continue:enabled').waitFor();
    await page.locator('#preferences-continue').click(); await page.locator('#ready-open:enabled').waitFor();
    await page.locator('#ready-open').click(); await page.waitForURL('http://127.0.0.1:*/');
    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
    assert.equal(receipt.version, status.version); assert.equal(receipt.documentHash, status.documentHash); assert.ok(receipt.acceptedAt);
    assert.equal((await page.evaluate(async () => (await (await fetch('/api/session')).json()).connection)), null);
    passed.push('Keyboard scrolling, checkbox changes and back navigation work; acceptance persists before opening without connecting AI');
    await app.close(); app = null;
    await start(); await unlock();
    await page.locator('#ready-open:enabled').waitFor();
    assert.equal(await page.locator('#terms-agree').isChecked(), true);
    assert.equal(await page.locator('#terms-agree').isDisabled(), true);
    assert.match(await page.locator('#ready-open').innerText(), /Enter Case Forge/);
    assert.equal(await page.locator('#terms-reader').evaluate(el => el.scrollTop), 0);
    assert.deepEqual(JSON.parse(readFileSync(receiptPath, 'utf8')), receipt);
    await capture('accepted-night', 1304, 841, '22');
    passed.push('Restart retains acceptance and leaves the full document available to review');
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: true }); });
    const nextWindow = app.waitForEvent('window');
    await page.locator('#setup-reset-app').click(); page = await nextWindow; observe(page);
    await page.locator('#setup-configure-pin:enabled').waitFor();
    assert.equal(existsSync(receiptPath), false);
    assert.match(readFileSync(join(folder, 'CASE-DETAILS.md'), 'utf8'), /Acceptance test only/);
    passed.push('Confirmed fictional setup reset clears acceptance and preserves the case file');
    assert.deepEqual(errors, []); assert.deepEqual(failedAssets, []);
    const report = { version, profile, passed, layouts, errors, failedAssets, verifiedAt: new Date().toISOString() };
    writeFileSync(join(output, `terms-${version}-verification.json`), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ version, profile, passed, layouts: layouts.length, errors, failedAssets }));
  } finally { if (app) await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
