// Scene previews use a fictional, isolated profile. Never enter the user's PIN.
const { _electron } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { mkdtempSync, mkdirSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const assert = require('node:assert/strict');
const { PinSecurity } = require('../security.cjs');
const root = resolve(__dirname, '../..'), output = join(root, 'output/desktop-preview');
mkdirSync(output, { recursive: true });
const profile = mkdtempSync(join(output, 'scene-profile-')), pin = '739482';
new PinSecurity(join(profile, 'app-lock.json')).setup(pin, pin);
const env = { ...process.env, CASEFORGE_TEST_USER_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE;
const shots = [], errors = [], remote = [];
let app;

async function capture(page, screen, hour, minute, name, width = 1320, height = 880) {
  await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height), { width, height });
  await page.waitForFunction((size) => innerWidth === size.width && innerHeight === size.height, { width, height });
  await page.clock.setSystemTime(new Date(2026, 8, 16, hour, minute));
  await page.evaluate(() => window.CaseForgeScene.update(new Date()));
  await page.evaluate(async () => { await document.fonts.ready; await new Promise(requestAnimationFrame); });
  const state = await page.evaluate((screen) => {
    const bounds = (selector) => { const r = document.querySelector(selector).getBoundingClientRect(); return { top: r.top, bottom: r.bottom, width: r.width }; };
    const selectors = screen === 'lock' ? ['#pin', '#lock-choose-folder'] : ['#setup-configure-pin', '#setup-choose-folder'];
    return {
      mode: document.documentElement.dataset.sceneMode, phase: document.documentElement.dataset.scenePhase,
      clockMode: window.CaseForgeScene.getState(new Date()).mode,
      logo: document.querySelector('header img').getAttribute('src'),
      card: getComputedStyle(document.querySelector('.entry-card')).backgroundColor,
      text: getComputedStyle(document.querySelector('.entry-card')).color,
      controls: selectors.map(bounds), cards: Array.from(document.querySelectorAll('.entry-card'), (el) => ({ top: el.getBoundingClientRect().top, bottom: el.getBoundingClientRect().bottom })),
      width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
      sun: getComputedStyle(document.documentElement).getPropertyValue('--sun-opacity').trim(),
      stars: getComputedStyle(document.documentElement).getPropertyValue('--stars-opacity').trim(),
    };
  }, screen);
  assert.equal(state.mode, state.clockMode);
  assert.equal(state.logo, state.mode === 'light' ? 'brand/logo.svg' : 'brand/logo-reversed.svg');
  assert.ok(state.scrollWidth <= width);
  for (const edge of ['top', 'bottom', 'width']) assert.ok(Math.abs(state.controls[0][edge] - state.controls[1][edge]) <= 0.5, `${name}: controls ${edge} must align`);
  for (const item of state.controls) assert.ok(item.top >= 0 && item.bottom <= height, `${name}: primary controls must fit`);
  assert.ok(Math.abs(state.cards[0].top - state.cards[1].top) <= 0.5);
  assert.ok(Math.abs(state.cards[0].bottom - state.cards[1].bottom) <= 0.5);
  const file = join(output, `scene-${screen}-${name}-${width}x${height}.png`);
  await page.screenshot({ path: file });
  shots.push({ screen, name, hour, minute, file, ...state });
}

(async () => {
  try {
    app = await _electron.launch({ executablePath: join(root, 'desktop/node_modules/electron/dist/electron.exe'), args: [join(root, 'desktop/main.cjs')], env, cwd: root, timeout: 30000 });
    const identity = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, profile: app.getPath('userData') }));
    assert.equal(identity.packaged, false);
    assert.equal(resolve(identity.profile), profile);
    const page = await app.firstWindow();
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => { if (/^https?:/.test(request.url())) remote.push(request.url()); });
    await page.locator('#pin-form:not([hidden])').waitFor();
    await page.waitForFunction(() => !!window.CaseForgeScene && document.querySelector('.landscape svg'));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.clock.install({ time: new Date(2026, 8, 16, 6, 0) });
    for (const [hour, minute, name] of [[6, 0, 'dawn'], [12, 0, 'noon'], [18, 0, 'sunset'], [0, 0, 'night']]) await capture(page, 'lock', hour, minute, name);
    await capture(page, 'lock', 12, 0, 'noon', 820, 650);
    await capture(page, 'lock', 0, 0, 'night', 820, 650);
    const day = shots.find((shot) => shot.name === 'noon'), night = shots.find((shot) => shot.name === 'night');
    assert.equal(day.mode, 'light'); assert.equal(night.mode, 'dark');
    assert.notEqual(day.card, night.card); assert.notEqual(day.text, night.text);
    assert.ok(Number(day.sun) > 0.9 && Number(night.sun) < 0.01);
    assert.ok(Number(day.stars) < 0.01 && Number(night.stars) > 0.5);
    // Re-focus after a clock jump, as happens after sleep or changing system time.
    await page.clock.setSystemTime(new Date(2026, 8, 16, 12, 0));
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    assert.equal(await page.locator('html').getAttribute('data-scene-mode'), 'light');
    // Authenticate only the isolated fictional profile to check the setup surface.
    await page.locator('#lock-choose-folder').click();
    await page.locator('#pin').fill(pin); await page.locator('#pin').press('Enter');
    await page.waitForURL('caseforge://lock/setup.html');
    await page.locator('#setup-configure-pin:enabled').waitFor();
    await page.waitForFunction(() => !!window.CaseForgeScene && document.querySelector('.landscape svg'));
    await capture(page, 'setup', 12, 0, 'noon', 820, 650);
    await capture(page, 'setup', 0, 0, 'night', 820, 650);
    assert.deepEqual(errors, []); assert.deepEqual(remote, []);
    assert.deepEqual(await app.evaluate(() => process._getActiveHandles().filter((h) => h.constructor?.name === 'Server' && h.listening)), []);
    writeFileSync(join(output, 'native-scene.json'), JSON.stringify({ version: require('../package.json').version, shots, errors, remoteRequests: remote, focusRefreshPassed: true, profile, testedAt: new Date().toISOString() }, null, 2));
    console.log(JSON.stringify({ screenshots: shots.length, errors, remoteRequests: remote, focusRefreshPassed: true }));
  } catch (error) {
    if (app?.windows()[0]) await app.windows()[0].screenshot({ path: join(output, 'native-scene-error.png') }).catch(() => {});
    console.error(error); process.exitCode = 1;
  } finally { if (app) await app.close(); }
})();
