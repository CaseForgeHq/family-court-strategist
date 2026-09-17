// Fictional profile, simulated weather. Never reads the installed user's profile.
const { _electron } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { mkdirSync, mkdtempSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const assert = require('node:assert/strict');
const root = resolve(__dirname, '../..'), output = join(root, 'output/weather-preview');
mkdirSync(output, { recursive: true });
const profile = mkdtempSync(join(output, 'profile-'));
writeFileSync(join(profile, 'scene-preferences.json'), JSON.stringify({ cityId: 'brisbane', weatherEnabled: false }));
const env = { ...process.env, CASEFORGE_TEST_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
(async () => {
  let app;
  try {
    app = await _electron.launch({ executablePath: join(root, 'desktop/node_modules/electron/dist/electron.exe'), args: [join(root, 'desktop/main.cjs')], env, cwd: root });
    const page = await app.firstWindow(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => window.CaseForgeScene && document.querySelector('canvas.weather-rain'), null, { timeout: 15000 }).catch(async error => {
      console.error(await page.evaluate(() => ({ url: location.href, title: document.title, canvas: !!document.querySelector('canvas'), scene: !!window.CaseForgeScene })), errors);
      await page.screenshot({ path: join(output, 'preview-error.png') }); throw error;
    });
    await page.waitForTimeout(1000);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const set = (condition, precipitation) => page.evaluate(({ condition, precipitation }) => {
      window.CaseForgeScene.setWeather({ condition, cloudCover: .95, precipitation, precipitationHours: 1 });
      window.CaseForgeScene.update(new Date(2026, 8, 17, 18, 15));
    }, { condition, precipitation });
    const pixels = () => page.locator('canvas.weather-rain').evaluate(c => c.toDataURL());
    await set('rain', 2); await page.waitForTimeout(150);
    const first = await pixels(); await page.waitForTimeout(250); assert.notEqual(await pixels(), first);
    await page.screenshot({ path: join(output, 'rain.png') });
    await set('storm', 10); await page.waitForTimeout(200);
    await page.screenshot({ path: join(output, 'storm.png') });
    await page.evaluate(() => { document.documentElement.dataset.sceneHidden = 'true'; });
    await page.waitForTimeout(100);
    assert.equal(await page.locator('canvas.weather-rain').evaluate(c => c.getContext('2d').getImageData(0, 0, c.width, c.height).data.some(v => v !== 0)), false);
    await page.evaluate(() => { document.documentElement.dataset.sceneHidden = 'false'; });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
    await page.waitForTimeout(500);
    const still = await pixels(); await page.waitForTimeout(200); assert.ok(await pixels() === still, 'Reduced motion must remain static');
    await page.evaluate(() => window.CaseForgeScene.setWeather(null)); await page.waitForTimeout(50);
    assert.equal(await page.locator('canvas.weather-rain').evaluate(c => c.getContext('2d').getImageData(0, 0, c.width, c.height).data.some(v => v !== 0)), false);
    assert.deepEqual(errors, []);
    writeFileSync(join(output, 'report.json'), JSON.stringify({ animated: true, reducedMotionStatic: true, hiddenClears: true, offClears: true, errors, simulatedWeather: true }, null, 2));
    console.log('Native rain: animation, storm render, reduced motion and off clearing passed.');
  } finally { await app?.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
