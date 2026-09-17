// Two-card startup checks use fictional files and a unique development profile.
// The native folder picker is stubbed; PIN checks and workspace transitions are real.
const { _electron } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { mkdirSync, mkdtempSync, writeFileSync, readFileSync } = require('node:fs');
const { join, resolve, basename } = require('node:path');
const assert = require('node:assert/strict');
const { PinSecurity } = require('../security.cjs');
const version = require('../package.json').version;

const root = resolve(__dirname, '../..'), output = join(root, 'output/desktop-preview');
for (const file of ['lock.html', 'setup.html']) {
  assert.match(readFileSync(join(root, 'desktop', file), 'utf8'), /entry-card/, `${file} must contain the new entry cards before running this test`);
}
mkdirSync(output, { recursive: true });
const profile = mkdtempSync(join(output, 'entry-cards-profile-'));
const firstCase = join(profile, 'Fictional Private Folder Alpha');
const secondCase = join(profile, 'Fictional Private Folder Beta');
for (const folder of [firstCase, secondCase]) {
  mkdirSync(folder);
  writeFileSync(join(folder, 'CASE-DETAILS.md'), `# ${basename(folder)}\n\nFictional startup test only.\n`);
  writeFileSync(join(folder, 'saved-evidence.txt'), 'Fictional evidence that must remain unchanged.\r\n');
}
const savedEvidence = readFileSync(join(firstCase, 'saved-evidence.txt'));
const config = join(profile, 'config.json'), pin = '739482';
new PinSecurity(join(profile, 'app-lock.json')).setup(pin, pin);
writeFileSync(config, JSON.stringify({ vault: firstCase }));
const initialConfig = readFileSync(config);
const env = { ...process.env, CASEFORGE_TEST_USER_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE;
const passed = [], layouts = [], pageErrors = [];
let app;

function observe(page) {
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('dialog', (dialog) => { if (dialog.type() !== 'beforeunload') void dialog.dismiss().catch(() => {}); });
  return page;
}
async function listeningServers() {
  // Electron's inspector uses a pipe. A live Node HTTP service appears here as
  // a listening Server handle; verify that this detects the workspace after opening it.
  return app.evaluate(() => process._getActiveHandles()
    .filter((handle) => handle.constructor?.name === 'Server' && handle.listening && typeof handle.address === 'function')
    .map((handle) => handle.address()));
}
async function setFolderResponse(path, canceled = false) {
  await app.evaluate(({ dialog }, value) => {
    process.entryCardPickerCalls = 0;
    dialog.showOpenDialog = async () => {
      process.entryCardPickerCalls++;
      return { canceled: value.canceled, filePaths: value.path ? [value.path] : [] };
    };
  }, { path, canceled });
}
async function noCaseAccess(page) {
  const text = await page.locator('body').innerText();
  for (const folder of [firstCase, secondCase]) {
    assert.equal(text.includes(folder), false, 'Locked text must not reveal a saved path');
    assert.equal(text.includes(basename(folder)), false, 'Locked text must not reveal a saved case name');
  }
  assert.deepEqual(await page.evaluate(() => window.strategistDesktop.getSetupState()), { error: 'Access denied.' });
  assert.equal(await page.evaluate(() => window.strategistDesktop.chooseCaseFolder()), false);
  assert.deepEqual(await listeningServers(), []);
}
async function captureLayout(page, screen, width, height) {
  const expandedPin = screen === 'setup-expanded';
  await page.locator('[data-app-version]').filter({ hasText: `Case Forge v${version}` }).waitFor();
  assert.equal(await page.locator('details, summary, select').count(), 0, 'Entry cards have no dropdowns');
  assert.equal(await page.getByRole('button', { name: /open (my )?workspace/i }).count(), 0, 'Entry has no visible Open workspace button');
  assert.equal(await page.locator('#setup-open-workspace, #setup-ready').count(), 0);
  if (screen === 'lock') assert.equal(await page.locator('#unlock').isVisible(), false);
  else assert.equal(await page.locator('#setup-pin-form').isVisible(), expandedPin, 'Check the requested setup PIN form state');
  assert.equal(await page.locator('.device-note').count(), 0, 'The corner device badge is removed');
  assert.doesNotMatch(await page.locator('body').innerText(), /\b(?:On this computer|Local workspace)\b/, 'Entry screens omit the removed corner labels');
  assert.match(await page.locator('body > footer').innerText(), /Reset app setup/);
  await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height), { width, height });
  await page.waitForFunction((size) => innerWidth === size.width && innerHeight === size.height, { width, height });
  await page.evaluate(async () => { await document.fonts.ready; await new Promise(requestAnimationFrame); });
  const fonts = await page.evaluate(() => {
    function sources(sheet) {
      return Array.from(sheet.cssRules).flatMap((rule) => {
        if (rule.type === CSSRule.IMPORT_RULE) return sources(rule.styleSheet);
        if (rule.type !== CSSRule.FONT_FACE_RULE) return [];
        const path = rule.style.getPropertyValue('src').match(/url\(["']?([^"')]+)/)?.[1];
        return path ? [new URL(path, sheet.href).href] : [];
      });
    }
    return {
      body: getComputedStyle(document.body).fontFamily,
      heading: getComputedStyle(document.querySelector('.entry-card h2')).fontFamily,
      faces: Array.from(document.fonts, (face) => ({ family: face.family, status: face.status })),
      resources: Array.from(document.styleSheets).flatMap(sources),
    };
  });
  assert.match(fonts.body, /^['"]?Quicksand/i);
  assert.match(fonts.heading, /^['"]?Ubuntu/i);
  for (const family of ['Ubuntu', 'Quicksand']) {
    assert.ok(fonts.faces.some((face) => face.family.replace(/["']/g, '') === family && face.status === 'loaded'), `${family} must actually load`);
    assert.ok(fonts.resources.some((url) => url.startsWith('caseforge://') && url.toLowerCase().includes(family.toLowerCase())), `${family} must load from the local app`);
  }
  const selectors = (expandedPin
    ? ['#setup-current-pin', '#setup-new-pin', '#setup-confirm-pin', '#setup-save-pin', '#setup-cancel-pin', '#setup-choose-folder']
    : screen === 'lock'
    ? ['#pin', '#lock-choose-folder', '#lock-reset-setup']
    : ['#setup-configure-pin', '#setup-choose-folder', '#setup-create-folder', '#setup-reset-app'])
    .concat(expandedPin ? [] : ['[data-app-version]']);
  const primaryControls = expandedPin ? ['#setup-save-pin', '#setup-choose-folder'] : screen === 'lock' ? ['#pin', '#lock-choose-folder'] : ['#setup-configure-pin', '#setup-choose-folder'];
  const layout = await page.evaluate(({ selectors, primaryControls }) => {
    const bounds = (element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
    };
    return {
      viewport: { width: innerWidth, height: innerHeight },
      scrollWidth: document.documentElement.scrollWidth,
      alignment: {
        cards: Array.from(document.querySelectorAll('.entry-card'), bounds),
        headings: Array.from(document.querySelectorAll('.entry-card h2'), bounds),
        controls: primaryControls.map((selector) => ({ selector, ...bounds(document.querySelector(selector)) })),
      },
      buttons: selectors.map((selector) => {
        const element = document.querySelector(selector), rect = bounds(element);
        return { selector, visible: !element.hidden && rect.width > 0 && rect.height > 0,
          inViewport: rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1,
          bounds: rect };
      }),
    };
  }, { selectors, primaryControls });
  const screenshot = join(output, `desktop-entry-${screen}-${width}x${height}.png`);
  await page.screenshot({ path: screenshot });
  layouts.push({ screen, screenshot, fonts, ...layout });
}
async function expectSetup(page) {
  await page.waitForURL('caseforge://lock/setup.html');
  await page.locator('#setup-choose-folder:enabled').waitFor();
  assert.equal(await page.locator('.entry-card').count(), 2);
  assert.deepEqual(await listeningServers(), [], 'Entering setup must not start the case service');
}

(async () => {
  try {
    app = await _electron.launch({ executablePath: join(root, 'desktop/node_modules/electron/dist/electron.exe'),
      args: [join(root, 'desktop/main.cjs')], env, cwd: root, timeout: 30000 });
    const identity = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, profile: app.getPath('userData') }));
    assert.equal(identity.packaged, false, 'Never enter test credentials in a packaged application');
    assert.equal(resolve(identity.profile), profile, 'Never enter test credentials outside the exact isolated profile');
    let page = observe(await app.firstWindow());
    await page.locator('#pin-form:not([hidden])').waitFor();
    await page.locator('#unlock:enabled').waitFor({ state: 'attached' });
    assert.equal(await page.locator('.entry-card').count(), 2);
    await setFolderResponse(secondCase);
    await noCaseAccess(page);
    assert.equal(await app.evaluate(() => process.entryCardPickerCalls), 0);
    passed.push('Locked startup shows two cards while hiding saved case names, paths and folder-picker access');
    await captureLayout(page, 'lock', 1320, 880);
    await captureLayout(page, 'lock', 820, 650);

    await page.locator('#lock-choose-folder').click();
    assert.equal(await page.locator('#pin').evaluate((element) => element === document.activeElement), true);
    await page.locator('#pin').fill('999999'); await page.locator('#pin').press('Enter');
    await page.locator('#lock-message').filter({ hasText: 'That PIN was not recognised.' }).waitFor();
    assert.equal(page.url(), 'caseforge://lock/lock.html');
    await noCaseAccess(page);
    assert.deepEqual(readFileSync(config), initialConfig);
    assert.equal(await page.locator('#pin').inputValue(), '');
    passed.push('Folder action focuses the PIN; an incorrect PIN preserves lock, folder settings and closed service');

    await page.locator('#pin').fill(pin); await page.locator('#pin').press('Enter');
    await expectSetup(page);
    const initialState = await page.evaluate(() => window.strategistDesktop.getSetupState());
    assert.deepEqual(initialState, { pinConfigured: true, folderSelected: true, folderName: basename(firstCase), folderPath: firstCase });
    passed.push('Correct folder-intent PIN reaches setup; initial complete settings reveal the folder without automatically opening a case service');
    await captureLayout(page, 'setup', 1320, 880);
    await captureLayout(page, 'setup', 820, 650);
    await page.locator('#setup-configure-pin').click();
    await captureLayout(page, 'setup-expanded', 820, 650);
    await page.locator('#setup-cancel-pin').click();
    await expectSetup(page);
    assert.equal(await page.locator('#setup-pin-form').isVisible(), false);
    assert.deepEqual(readFileSync(config), initialConfig);

    await setFolderResponse(null, true);
    await page.locator('#setup-choose-folder').click();
    await page.locator('#setup-choose-folder:enabled').waitFor();
    assert.equal(await app.evaluate(() => process.entryCardPickerCalls), 1);
    assert.deepEqual(await page.evaluate(() => window.strategistDesktop.getSetupState()), initialState);
    assert.deepEqual(readFileSync(config), initialConfig);
    await expectSetup(page);
    passed.push('Cancelling the folder picker preserves the selected folder and keeps the case service closed');

    await setFolderResponse(secondCase);
    await page.locator('#setup-choose-folder').click();
    await page.waitForURL('http://127.0.0.1:*/'); await page.locator('.home-introduction').waitFor();
    assert.equal(JSON.parse(readFileSync(config, 'utf8')).vault, secondCase);
    await page.locator('#home-folder-status').filter({ hasText: basename(secondCase) }).waitFor();
    const origin = new URL(page.url()).origin, servers = await listeningServers();
    assert.equal(servers.some((address) => address.port === Number(new URL(origin).port)), true, 'The handle check must detect the now-open case service');
    assert.equal(await page.evaluate(async () => (await fetch('/api/case')).status), 200);
    passed.push('Selecting a different folder with an authenticated PIN automatically opens that workspace');

    const nextWindow = app.waitForEvent('window'); await page.locator('#lock-app').click();
    page = observe(await nextWindow); await page.locator('#pin-form:not([hidden])').waitFor();
    await noCaseAccess(page);
    await assert.rejects(fetch(origin + '/api/case', { signal: AbortSignal.timeout(5000) }));
    await page.locator('#pin').fill(pin); await page.locator('#pin').press('Enter');
    await page.waitForURL('http://127.0.0.1:*/'); await page.locator('.home-introduction').waitFor();
    await page.locator('#home-folder-status').filter({ hasText: basename(secondCase) }).waitFor();
    assert.equal(await page.evaluate(async () => (await fetch('/api/case')).status), 200);
    assert.equal(app.windows().length, 1);
    assert.deepEqual(readFileSync(join(firstCase, 'saved-evidence.txt')), savedEvidence);
    assert.deepEqual(readFileSync(join(secondCase, 'saved-evidence.txt')), savedEvidence);
    assert.deepEqual(pageErrors, []);
    passed.push('Normal relock and direct PIN unlock reopen the selected workspace and preserve saved evidence');

    writeFileSync(join(output, 'native-entry-cards.json'), JSON.stringify({ passed, layouts, profile, testedAt: new Date().toISOString() }, null, 2));
    for (const layout of layouts) {
      const label = `${layout.screen} ${layout.viewport.width}×${layout.viewport.height}`;
      const { cards, headings, controls } = layout.alignment;
      assert.equal(cards.length, 2); assert.equal(headings.length, 2); assert.equal(controls.length, 2);
      const aligned = (first, second, name) => assert.ok(Math.abs(first - second) <= 0.5, `${label}: ${name} differ (${first} vs ${second})`);
      for (const edge of ['top', 'bottom', 'width', 'height']) aligned(cards[0][edge], cards[1][edge], `card ${edge}`);
      assert.ok(cards[0].right < cards[1].left, `${label}: the two cards remain side by side`);
      aligned(headings[0].top, headings[1].top, 'heading tops');
      aligned(headings[0].left - cards[0].left, headings[1].left - cards[1].left, 'heading left insets');
      for (const edge of layout.screen === 'setup-expanded' ? ['top', 'bottom'] : ['top', 'bottom', 'width']) aligned(controls[0][edge], controls[1][edge], `primary control ${edge}`);
      assert.ok(layout.scrollWidth <= layout.viewport.width, `${layout.screen} ${layout.viewport.width}: horizontal overflow`);
      for (const button of layout.buttons) assert.ok(button.visible && button.inViewport,
        `${layout.screen} ${layout.viewport.width}: ${button.selector} must be visible without scrolling (${JSON.stringify(button.bounds)})`);
    }
    passed.push(`Lock and closed setup at 1320×880 and 820×650 align card bounds, headings and primary controls within 0.5px; removed corner labels stay absent, local fonts load, and actions/version ${version} remain visible`);
    passed.push('Expanded Change PIN at 820×650 keeps all three PIN fields, Save PIN, Cancel and Choose location visible, with both primary controls aligned; cancelling preserves the selected case');
    writeFileSync(join(output, 'native-entry-cards.json'), JSON.stringify({ passed, layouts, profile, testedAt: new Date().toISOString() }, null, 2));
    console.log(JSON.stringify({ passed, layouts, profile }, null, 2));
  } catch (error) {
    console.error(error);
    writeFileSync(join(output, 'native-entry-cards.json'), JSON.stringify({ passed, layouts, profile, error: error.message, testedAt: new Date().toISOString() }, null, 2));
    if (app) {
      const page = app.windows()[0];
      if (page) await page.screenshot({ path: join(output, 'native-entry-cards-error.png') }).catch(() => {});
    }
    process.exitCode = 1;
  } finally { if (app) await app.close(); }
})();
