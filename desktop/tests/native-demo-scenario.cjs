const { _electron } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { mkdirSync, mkdtempSync, cpSync, writeFileSync, readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const assert = require('node:assert/strict');
const { PinSecurity } = require('../security.cjs');
const { createWorkspacePreferences } = require('../workspace-preferences.cjs');
const { reviewTerms } = require('./terms-helper.cjs');
const root = resolve(__dirname, '../..'), out = join(root, 'output/demo-scenario');
mkdirSync(out, { recursive: true });
const profile = mkdtempSync(join(out, 'profile-')), folder = join(profile, 'Example Case');
cpSync(join(root, 'sample-case'), folder, { recursive: true });
writeFileSync(join(folder, 'preserve.txt'), 'Original fictional case remains unchanged');
writeFileSync(join(profile, 'config.json'), JSON.stringify({ vault: folder }));
writeFileSync(join(profile, 'scene-preferences.json'), JSON.stringify({ cityId: 'brisbane', weatherEnabled: false }));
const pin = '739482'; new PinSecurity(join(profile, 'app-lock.json')).setup(pin, pin);
createWorkspacePreferences(join(profile, 'workspace-preferences.json')).set(folder, { caseName: 'Original example', preferredProvider: 'ollama', aiPlan: 'free', advancedIntelligence: false });
const env = { ...process.env, CASEFORGE_TEST_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
(async () => {
  let app; const errors = [];
  try {
    app = await _electron.launch({ executablePath: join(root, 'desktop/node_modules/electron/dist/electron.exe'), args: [join(root, 'desktop/main.cjs')], env, cwd: root });
    const page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
    await page.locator('#pin:enabled').fill(pin); await page.locator('#pin').press('Enter');
    await page.locator('#preferences-continue:enabled').click(); await reviewTerms(page);
    await page.locator('#ready-open:enabled').click(); await page.waitForURL('http://127.0.0.1:*/');
    const open = async () => {
      await page.locator('#open-admin:not([hidden])').waitFor({ state: 'attached' });
      if (!await page.locator('.more-tools').evaluate(el => el.open)) await page.locator('.more-tools summary').click();
      await page.locator('#open-admin').click(); await page.locator('.admin-size').first().waitFor();
    };
    await open();
    for (const [label, width, height] of [['wide', 1304, 841], ['compact', 804, 619]]) {
      await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(...size), [width, height]);
      await page.waitForTimeout(300);
      const box = await page.locator('.admin-create').boundingBox();
      assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= height);
      await page.screenshot({ path: join(out, `simulation-${label}.png`) });
    }
    await page.locator('.admin-create').click();
    await page.waitForFunction(() => document.querySelector('#count-people')?.textContent === '8');
    await page.locator('[data-view="people"]').click(); await page.locator('.person').first().waitFor();
    assert.equal(await page.locator('.person').count(), 8);
    await page.screenshot({ path: join(out, 'people.png') });
    await page.locator('[data-view="timeline"]').click(); await page.getByText('Case closed — handover summary', { exact: true }).waitFor();
    await page.screenshot({ path: join(out, 'timeline.png') });
    await page.locator('[data-view="notebook"]').click(); await page.locator('[data-notebook-page]').first().waitFor();
    assert.equal(await page.locator('[data-notebook-page]').count(), 3);
    await page.screenshot({ path: join(out, 'notebook.png') });
    await open(); await page.locator('.admin-return').click();
    await page.waitForFunction(() => document.querySelector('#current-matter')?.textContent.includes('Original example'));
    assert.equal(readFileSync(join(folder, 'preserve.txt'), 'utf8'), 'Original fictional case remains unchanged');
    assert.deepEqual(errors, []);
    writeFileSync(join(out, 'report.json'), JSON.stringify({ profile, generatedAndOpened: true, returnedToOriginal: true, originalPreserved: true, errors }, null, 2));
    console.log('Native demo creation, people, timeline, notebook and safe return passed.');
  } finally { if (app) await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
