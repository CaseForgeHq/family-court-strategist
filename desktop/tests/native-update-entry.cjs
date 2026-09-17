// Disposable-profile UI rehearsal. Updater events are simulated, never a real download.
const { _electron } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { mkdtempSync, mkdirSync, writeFileSync } = require('node:fs');
const { resolve, join } = require('node:path');
const assert = require('node:assert/strict');
const root = resolve(__dirname, '../..'), out = join(root, 'output/update-entry');
mkdirSync(out, { recursive: true });
const profile = mkdtempSync(join(out, 'profile-'));
const env = { ...process.env, CASEFORGE_TEST_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
(async () => {
  let app; const errors = [], captures = [];
  try {
    app = await _electron.launch({ executablePath: join(root, 'desktop/node_modules/electron/dist/electron.exe'), args: [join(root, 'desktop/main.cjs')], cwd: root, env });
    const page = await app.firstWindow(); page.on('pageerror', e => errors.push(e.message));
    page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
    await page.waitForURL('caseforge://lock/setup.html');
    await page.locator('#open-updates').waitFor({ state: 'attached' });
    assert.equal(await page.locator('#open-updates').isVisible(), false);
    assert.equal((await page.evaluate(() => window.strategistDesktop.updateStatus())).phase, 'unavailable');
    assert.equal(await page.locator('#updates-popover').isVisible(), false);
    await app.evaluate(({ ipcMain }) => {
      global.fixtureUpdate = { phase: 'available', version: '0.15.0', currentVersion: '0.14.0', required: true, message: 'Update ready.' };
      ipcMain.removeHandler('updates:status'); ipcMain.handle('updates:status', () => global.fixtureUpdate);
      ipcMain.removeHandler('updates:download'); ipcMain.handle('updates:download', () => { global.fixtureUpdate = { ...global.fixtureUpdate, phase: 'ready', progress: 100 }; return global.fixtureUpdate; });
    });
    await page.locator('#open-updates').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#updates-popover').isVisible(), false, 'Arrival offers the icon without opening a message');
    await page.locator('#open-updates').click();
    await page.locator('#updates-popover:not([hidden])').waitFor();
    assert.equal(await page.locator('.updates-sender').textContent(), 'Case Forge Admin Says');
    assert.equal(await page.locator('#updates-popover').getAttribute('aria-label'), 'Required update message');
    for (const [name, width, height, hour] of [['registration-day', 1304, 841, 12], ['registration-compact', 804, 619, 12], ['registration-night', 1304, 841, 22]]) {
      await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(...size), [width, height]);
      await page.waitForFunction(size => innerWidth === size[0] && innerHeight === size[1], [width, height]);
      await page.evaluate(hour => window.CaseForgeScene.update(new Date(`2026-09-17T${hour}:00:00+10:00`)), hour);
      await page.waitForTimeout(700);
      const bounds = await page.locator('#updates-popover').boundingBox();
      assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= width && bounds.y + bounds.height <= height);
      await page.screenshot({ path: join(out, `${name}.png`) }); captures.push(name);
    }
    await page.locator('[data-update-action]').click();
    await page.waitForFunction(() => document.querySelector('[data-update-action]').textContent === 'Restart and install');
    await page.keyboard.press('Escape'); assert.equal(await page.locator('#updates-popover').isVisible(), false);
    await page.locator('#open-updates').click(); assert.equal(await page.locator('#updates-popover').isVisible(), true);
    await app.evaluate(({ BrowserWindow }) => {
      global.fixtureUpdate = { ...global.fixtureUpdate, phase: 'available', version: '0.15.2', notices: [
        { id:'v0.15.0', version:'0.15.0', message:'Notebook updated.' },
        { id:'v0.15.2', version:'0.15.2', message:'People connections updated.' },
        { id:'v0.15.1', version:'0.15.1', message:'File search updated.' },
      ] };
      BrowserWindow.getAllWindows()[0].webContents.send('updates:status-changed',global.fixtureUpdate);
    });
    await page.waitForFunction(() => document.querySelectorAll('.updates-message').length === 3);
    assert.deepEqual(await page.locator('.updates-message p').allTextContents(), ['People connections updated.','File search updated.','Notebook updated.']);
    assert.equal(await page.locator('[data-update-action]').count(),1);
    assert.equal(await page.locator('#updates-popover').isVisible(),true);
    await app.evaluate(({ BrowserWindow }) => {
      global.fixtureUpdate = { ...global.fixtureUpdate, phase:'current', version:null, message:'' };
      BrowserWindow.getAllWindows()[0].webContents.send('updates:status-changed',global.fixtureUpdate);
    });
    await page.waitForFunction(() => document.querySelector('#updates-popover').dataset.phase === 'current');
    assert.equal(await page.locator('[data-update-action]').isVisible(),true,'History ahead of metadata still offers Download');
    await app.evaluate(({ BrowserWindow }) => {
      global.fixtureUpdate = { ...global.fixtureUpdate, phase:'available', version:'0.15.2' };
      BrowserWindow.getAllWindows()[0].webContents.send('updates:status-changed',global.fixtureUpdate);
    });
    await page.waitForFunction(() => document.querySelector('#updates-popover').dataset.phase === 'available');
    await page.screenshot({ path: join(out,'independent-messages.png') }); captures.push('independent-messages');
    await page.keyboard.press('Escape');
    await app.evaluate(({ BrowserWindow }) => {
      global.fixtureUpdate.notices.unshift({ id:'v0.15.3',version:'0.15.3',message:'<img src=x onerror=alert(1)> Separate message.' });
      BrowserWindow.getAllWindows()[0].webContents.send('updates:status-changed',global.fixtureUpdate);
    });
    await page.waitForFunction(() => document.querySelectorAll('.updates-message').length === 4);
    assert.equal(await page.locator('#updates-popover').isVisible(),false,'New message must not force the panel open');
    assert.equal(await page.locator('#updates-popover img').count(),0,'Admin messages are plain text');
    await page.locator('#open-updates').click();
    for (const [phase, progress, fullDownload] of [['downloading', 70, false], ['downloading', null, true], ['verifying', null, true], ['restarting', 100, false]]) {
      await app.evaluate(({ BrowserWindow }, value) => {
        global.fixtureUpdate = { ...global.fixtureUpdate, ...value };
        BrowserWindow.getAllWindows()[0].webContents.send('updates:status-changed', global.fixtureUpdate);
      }, { phase, progress, fullDownload });
      await page.waitForFunction(phase => document.querySelector('#updates-popover').dataset.phase === phase, phase);
      if (progress === null) assert.equal(await page.locator('#updates-popover progress').getAttribute('value'), null);
      await page.screenshot({ path: join(out, `${phase}${fullDownload ? '-full' : ''}.png`) });
    }
    assert.deepEqual(errors, []);
    writeFileSync(join(out, 'report.json'), JSON.stringify({ captures, errors, profile, transport: 'Simulated updater; real entry IPC checked in development mode' }, null, 2));
    console.log('Registration update arrival, shared card, download, keyboard and 3 native layouts passed.');
  } finally { if (app) await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

