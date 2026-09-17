const { _electron } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { join, resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const { writeFileSync, readFileSync, existsSync } = require('node:fs');
const assert = require('node:assert/strict');
const { extractFile } = require('../node_modules/@electron/asar');
const root = resolve(__dirname, '../..');
const executable = process.env.CASEFORGE_EXECUTABLE || join(root, 'desktop/dist/win-unpacked/Case Forge.exe');
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
(async () => {
  let app;
  try {
    app = await _electron.launch({ executablePath: executable, args: [], env, timeout: 30000 });
    const page = await app.firstWindow();
    await page.locator('#configure-stage:not([hidden])').waitFor();
    await page.locator('#scene-timezone:enabled').waitFor({ state: 'attached' });
    assert.equal(await page.locator('#welcome-continue, #welcome-stage, footer .entry-brand, footer .setup-progress').count(), 0);
    assert.equal(await page.locator('body > header .entry-brand img').count(), 1);
    assert.equal(await page.locator('main > .setup-progress').count(), 1);
    assert.equal(await page.locator('#scene-panel').isVisible(), false);
    await page.waitForFunction(() => !/Connecting|Loading/.test(document.getElementById('scene-weather-status').textContent));
    const weatherStatus = await page.locator('#scene-weather-status').textContent();
    assert.match(await page.locator('footer').innerText(), /Beta/);
    await page.locator('#scene-toggle').click(); await page.locator('#scene-panel').waitFor();
    await page.screenshot({ path: join(root, 'output/desktop-preview/packaged-weather-panel.png') });
    await page.locator('#scene-close').click();
    const info = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, version: app.getVersion(), resources: process.resourcesPath }));
    assert.equal(info.packaged, true); assert.equal(info.version, require('../package.json').version);
    const bundle = join(info.resources, 'app.asar');
    const assetProtocol = extractFile(bundle, 'main.cjs').toString('utf8');
    const planAssets = [['ai-plans.js', 'gemini-2.5-flash-lite'], ['ai-plans.js', 'astraUpgrade'], ['plans.css', '.astra-features'], ['setup.html', 'Customised for Case Forge.']]
      .map(([path, marker]) => ({ path, bundled: true, markerFound: extractFile(bundle, path).toString('utf8').includes(marker), allowlisted: assetProtocol.includes(`'${path}'`) }));
    assert.ok(planAssets.every(asset => asset.bundled && asset.markerFound && asset.allowlisted), 'Plan catalogue, styling and page must be packaged and allowed by the asset protocol');
    const termsAssets = [['terms.js', 'beta-1.0'], ['terms.css', '.terms-reader'], ['terms-screen.js', 'canContinue'], ['terms-acceptance.cjs', 'documentHash']].map(([path, marker]) => ({ path, bundled: true, markerFound: extractFile(bundle, path).toString('utf8').includes(marker), allowlisted: path.endsWith('.cjs') || assetProtocol.includes(`'${path}'`) }));
    assert.ok(termsAssets.every(asset => asset.markerFound && asset.allowlisted), 'The exact terms, receipt store and screen assets must be packaged');
    const workspaceRoot = join(info.resources,'app/public');
    const workspaceAssets = [['index.html','workspace-context'],['workspace.css','.case-desk.intake-shortcut'],['workspace-chrome.js','closeNavigationMenus'],['topbar.css','.workspace-shell'],['map-scene.js','WebGLRenderer'],['vendor/three/three.module.js','WebGLRenderer'],['app.js','viewSettings'],['scene/scene-time.js','CaseForgeScene'],['scene/scene-controls.js','scene-toggle']].map(([path,marker])=>({path,markerFound:readFileSync(join(workspaceRoot,path),'utf8').includes(marker)}));
    assert.ok(workspaceAssets.every(asset=>asset.markerFound),'The installed app must contain the current workspace and shared scene');
    for(const font of ['Ubuntu-Regular.ttf','Quicksand-VariableFont_wght.ttf'])assert.ok(readFileSync(join(workspaceRoot,'scene/fonts',font)).length>1000);
    await page.locator('[data-app-version]').filter({ hasText: `Case Forge v${info.version}` }).waitFor();
    const versionLabel = await page.locator('[data-app-version]').innerText();
    assert.equal(versionLabel, `Case Forge v${info.version}`);
    const reset = page.locator('#lock-reset-setup, #setup-reset-app');
    await reset.waitFor();
    assert.ok(page.url().startsWith('caseforge://lock/'));
    assert.equal(await page.locator('.entry-card').count(), 2);
    assert.equal(await page.locator('details, summary, select').count(), 0);
    assert.equal(await page.getByRole('button', { name: /open (my )?workspace/i }).count(), 0);
    assert.equal(await page.locator('#setup-open-workspace, #setup-ready').count(), 0);
    assert.equal(await page.locator('.device-note').count(), 0);
    assert.doesNotMatch(await page.locator('body').innerText(), /\b(?:On this computer|Local workspace)\b/);
    if (page.url().endsWith('lock.html')) assert.equal(await page.locator('#unlock').isVisible(), false);
    else assert.equal(await page.locator('#setup-pin-form').isVisible(), false);
    const fonts = await page.evaluate(async () => {
      await document.fonts.ready;
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
    assert.match(fonts.body, /^['"]?Quicksand/i); assert.match(fonts.heading, /^['"]?Ubuntu/i);
    for (const family of ['Ubuntu', 'Quicksand']) {
      assert.ok(fonts.faces.some((face) => face.family.replace(/["']/g, '') === family && face.status === 'loaded'));
      assert.ok(fonts.resources.some((url) => url.startsWith('caseforge://') && url.toLowerCase().includes(family.toLowerCase())));
    }
    const primaryControls = page.url().endsWith('lock.html') ? ['#pin', '#lock-choose-folder'] : ['#setup-configure-pin', '#setup-choose-folder'];
    const alignment = await page.evaluate((selectors) => {
      const bounds = (element) => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
      };
      return {
        viewportWidth: innerWidth,
        progress: bounds(document.querySelector('main > .setup-progress')),
        stage: bounds(document.getElementById(document.body.dataset.entryStage + '-stage')),
        cards: Array.from(document.querySelectorAll('.entry-card'), bounds),
        headings: Array.from(document.querySelectorAll('.entry-card h2'), bounds),
        controls: selectors.map((selector) => ({ selector, ...bounds(document.querySelector(selector)) })),
      };
    }, primaryControls);
    const aligned = (first, second, label) => assert.ok(Math.abs(first - second) <= 0.5, `${label} differ (${first} vs ${second})`);
    assert.ok(Math.abs(alignment.progress.left + alignment.progress.width / 2 - alignment.viewportWidth / 2) <= 1, 'Progress must be centered');
    aligned(alignment.progress.left, alignment.stage.left, 'Progress and section left edges');
    aligned(alignment.progress.width, alignment.stage.width, 'Progress and section widths');
    assert.ok(alignment.progress.bottom <= alignment.stage.top, 'Progress must sit above the visible stage');
    for (const edge of ['top', 'bottom', 'width', 'height']) aligned(alignment.cards[0][edge], alignment.cards[1][edge], `Card ${edge}`);
    assert.ok(alignment.cards[0].right < alignment.cards[1].left, 'Entry cards remain side by side');
    aligned(alignment.headings[0].top, alignment.headings[1].top, 'Heading tops');
    aligned(alignment.headings[0].left - alignment.cards[0].left, alignment.headings[1].left - alignment.cards[1].left, 'Heading left insets');
    for (const control of alignment.controls) assert.ok(control.width > 0 && control.height > 0, `${control.selector} must have visible bounds`);
    for (const edge of ['top', 'bottom', 'width']) aligned(alignment.controls[0][edge], alignment.controls[1][edge], `Primary control ${edge}`);
    await page.waitForFunction(() => !!window.CaseForgeScene && document.querySelectorAll('.alpine-scene [data-ridge]').length >= 6);
    const scene = await page.evaluate(() => ({
      phase: document.documentElement.dataset.scenePhase,
      mode: document.documentElement.dataset.sceneMode,
      expectedMode: window.CaseForgeScene.getState(new Date(), window.CaseForgeScene.getTimezone()).mode,
      logo: document.querySelector('body > header .entry-brand img').getAttribute('src'),
      ridges: document.querySelectorAll('.alpine-scene [data-ridge]').length,
    }));
    assert.equal(scene.mode, scene.expectedMode);
    assert.equal(scene.logo, scene.mode === 'light' ? 'brand/logo.svg' : 'brand/logo-reversed.svg');
    // Never create or enter a PIN in the user's packaged app profile.
    await page.screenshot({ path: join(root, 'output/desktop-preview/packaged-first-launch.png') });
    assert.ok(existsSync(join(info.resources, 'app/node_modules/pdfjs-dist/package.json')));
    const extraction = await import(pathToFileURL(join(info.resources, 'app/lib/extraction.js')).href);
    const { samplePdf } = await import('../../app/tests/helpers.js');
    const pages = await extraction.extractDocument(samplePdf(), '.pdf', new AbortController().signal);
    assert.match(pages[0].text, /Alex reported/);
    const report = { packaged: info.packaged, version: info.version, versionLabel, weatherStatus, planAssets, workspaceAssets, termsAssets, resetControlVisible: true, localFonts: fonts, noEntryDropdownsOrOpenButtons: true, removedCornerLabelsAbsent: true, alignment, scene, entryScreen: page.url().endsWith('setup.html') ? 'setup' : 'lock', pinSetByTest: false, bundledPdfExtractionPassed: true, testedAt: new Date().toISOString() };
    writeFileSync(join(root, 'output/desktop-preview/packaged-smoke.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } finally { if (app) await app.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
