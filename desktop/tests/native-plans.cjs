// Native page 02 visual/accessibility check; exclusively fictional profiles and files.
const { _electron } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const assert = require('node:assert/strict');
const { PinSecurity } = require('../security.cjs');
const version = require('../package.json').version;
const root = resolve(__dirname, '../..'), output = join(root, 'output/desktop-preview');
mkdirSync(output, { recursive: true });
const profile = mkdtempSync(join(output, 'plans-profile-')), folder = join(profile, 'Fictional plan preview');
mkdirSync(folder); writeFileSync(join(folder, 'CASE-DETAILS.md'), '# Fictional case\nFor interface verification only.');
writeFileSync(join(profile, 'config.json'), JSON.stringify({ vault: folder }));
writeFileSync(join(profile, 'scene-preferences.json'), JSON.stringify({ cityId: 'brisbane', weatherEnabled: false }));
const pin = '739482'; new PinSecurity(join(profile, 'app-lock.json')).setup(pin, pin);
const env = { ...process.env, CASEFORGE_TEST_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
const checks = [], layouts = [], errors = []; let app, page;

async function scrollPosition() {
  return page.evaluate(() => {
    const frame = document.querySelector('.plans-experience');
    return { x:scrollX, y:scrollY, frameX:frame.scrollLeft, frameY:frame.scrollTop };
  });
}

async function assertFocusDoesNotScroll(name) {
  const position = await scrollPosition();
  assert.deepEqual(position, { x:0, y:0, frameX:0, frameY:0 }, `${name}: page and plans start without scroll displacement`);
  for (const selector of ['#preferences-case-name', '#preferences-plan-free', '#preferences-plan-everyday', '#preferences-plan-plus', '#preferences-astra', '#preferences-back', '#preferences-continue']) {
    await page.locator(selector).focus();
    assert.deepEqual(await scrollPosition(), position, `${name}: focusing ${selector} must not scroll the page or plan content`);
  }
}

async function capture(name, width, height, hour) {
  await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(...size), [width, height]);
  await page.waitForFunction(size => innerWidth === size[0] && innerHeight === size[1], [width, height]);
  await page.evaluate(hour => { window.CaseForgeScene.update(new Date(`2026-09-16T${hour}:00:00+10:00`)); }, hour);
  await page.evaluate(async () => { await document.fonts.ready; await new Promise(requestAnimationFrame); await Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))); });
  await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(...size), [width, height]);
  await page.waitForTimeout(250);
  await page.waitForFunction(size => innerWidth === size[0] && innerHeight === size[1], [width, height]);
  const layout = await page.evaluate(() => {
    const bounds = el => { const r = el.getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height, right:r.right, bottom:r.bottom }; };
    const clip = document.querySelector('.plans-experience');
    const controls = ['#preferences-case-name', '.astra-option', '.astra-price', '.astra-choice', '#preferences-back', '#plan-preview-note', '#preferences-continue', '.entry-footer', ...Array.from(document.querySelectorAll('.entry-footer button')).filter(el => el.checkVisibility()).map(el => `#${el.id}`)];
    return { viewport:[innerWidth,innerHeight], pageWidth:document.documentElement.scrollWidth, pageHeight:document.documentElement.scrollHeight,
      frame:bounds(clip), scrollWidth:clip.scrollWidth, clientWidth:clip.clientWidth, scrollHeight:clip.scrollHeight, clientHeight:clip.clientHeight,
      cards:Array.from(document.querySelectorAll('.plan-card')).map(el => ({ ...bounds(el), scrollWidth:el.scrollWidth, clientWidth:el.clientWidth, scrollHeight:el.scrollHeight, clientHeight:el.clientHeight })),
      titles:Array.from(document.querySelectorAll('.plan-card h2')).map(bounds),
      prices:Array.from(document.querySelectorAll('.plan-price')).map(bounds),
      controls:controls.map(selector => { const el = document.querySelector(selector); return { selector, visible:el.checkVisibility(), ...bounds(el) }; }),
      content:Array.from(document.querySelectorAll('.plans-heading, .plan-card, .astra-option')).map(bounds),
      astra:bounds(document.querySelector('.astra-option')),
      notice:bounds(document.getElementById('plan-preview-note')), next:bounds(document.getElementById('preferences-continue')),
      mode:document.documentElement.dataset.sceneMode };
  });
  layouts.push({ name, ...layout });
  assert.ok(layout.pageWidth <= width + 1, `${name}: no horizontal page overflow`);
  assert.ok(layout.pageHeight <= height + 1, `${name}: native page must fit vertically`);
  assert.ok(layout.scrollWidth <= layout.clientWidth + 1, `${name}: plans fit without horizontal scrolling`);
  assert.ok(layout.scrollHeight <= layout.clientHeight + 1, `${name}: all plans and Astra fit without vertical scrolling (${layout.scrollHeight}/${layout.clientHeight})`);
  for (const control of layout.controls) {
    assert.ok(control.visible && control.width > 0 && control.height > 0, `${name}: ${control.selector} remains visible`);
    assert.ok(control.x >= -1 && control.y >= -1 && control.right <= width + 1 && control.bottom <= height + 1, `${name}: ${control.selector} is wholly inside the viewport (${JSON.stringify(control)})`);
  }
  for (const content of layout.content) {
    assert.ok(content.x >= layout.frame.x - 1 && content.right <= layout.frame.right + 1 && content.y >= layout.frame.y - 1 && content.bottom <= layout.frame.bottom + 1, `${name}: plan content is fully inside its frame, without clipping (${JSON.stringify(content)})`);
  }
  assert.equal(layout.cards.length, 3, `${name}: all three tiers displayed`);
  for (const card of layout.cards) {
    assert.ok(card.scrollWidth <= card.clientWidth + 2, `${name}: no card text overflows horizontally beyond the glass border (${card.scrollWidth}/${card.clientWidth})`);
    assert.ok(card.scrollHeight <= card.clientHeight + 2, `${name}: no card text overflows vertically beyond the glass border (${card.scrollHeight}/${card.clientHeight})`);
    assert.ok(Math.abs(card.height - layout.cards[0].height) < 1, `${name}: equal card heights`);
  }
  for (const key of ['cards','titles','prices']) for (const bounds of layout[key]) assert.ok(Math.abs(bounds.y - layout[key][0].y) < 1, `${name}: aligned ${key} in three columns`);
  for (let i=1; i<layout.cards.length; i++) assert.ok(layout.cards[i].x > layout.cards[i-1].right, `${name}: three distinct card columns remain side by side`);
  assert.ok(layout.astra.y >= Math.max(...layout.cards.map(card => card.bottom)), `${name}: Astra does not overlap the plan cards`);
  assert.ok(layout.frame.bottom <= layout.next.y && layout.frame.bottom <= layout.notice.y, `${name}: plan content does not overlap navigation`);
  await page.screenshot({ path:join(output, `plans-${version}-${name}.png`) });
  await assertFocusDoesNotScroll(name);
}

(async () => {
  try {
    app = await _electron.launch({ executablePath:join(root,'desktop/node_modules/electron/dist/electron.exe'), args:[join(root,'desktop/main.cjs')], env, cwd:root, timeout:30000 });
    assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), profile);
    page = await app.firstWindow(); page.on('pageerror', e => errors.push(e.message));
    await page.locator('#pin:enabled').waitFor(); await page.locator('#pin').fill(pin); await page.locator('#pin').press('Enter');
    await page.waitForURL('caseforge://lock/setup.html'); await page.locator('#preferences-continue:enabled').waitFor();
    await page.locator('#preferences-case-name').fill('My family case');
    assert.equal(await page.locator('#preferences-plan-free').isChecked(), true);
    await capture('day',1320,880,'12');
    await capture('night',1320,880,'22');
    await capture('screenshot-size',1238,803,'12');
    await capture('user-window',1304,841,'12');
    await capture('height-800',1238,800,'12');
    await capture('height-801',1238,801,'12');
    await capture('compact',1000,720,'12');
    await capture('compact-boundary',1000,721,'12');
    await capture('short-breakpoint',804,760,'12');
    await capture('short-breakpoint-after',804,761,'12');
    await capture('tall-breakpoint',1000,840,'12');
    await capture('tall-breakpoint-after',1000,841,'12');
    await capture('minimum',804,619,'12');
    const keyboardStart = await scrollPosition();
    await page.locator('#preferences-plan-free').focus(); await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('#preferences-plan-everyday').isChecked(), true);
    assert.deepEqual(await scrollPosition(), keyboardStart, 'Keyboard Everyday selection must not scroll');
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('#preferences-plan-plus').isChecked(), true);
    assert.deepEqual(await scrollPosition(), keyboardStart, 'Keyboard Plus selection must not scroll');
    await page.keyboard.press('ArrowLeft');
    assert.equal(await page.locator('#preferences-plan-everyday').isChecked(), true);
    await page.locator('#preferences-astra').focus(); await page.keyboard.press('Space');
    assert.equal(await page.locator('#preferences-astra').isChecked(), true);
    assert.deepEqual(await scrollPosition(), keyboardStart, 'Keyboard Astra selection must not scroll');
    await capture('minimum-astra',804,619,'12');
    checks.push('Aligned three-column day/night/screenshot/compact/minimum layouts; no page or plan scrolling; all controls and preview disclosure visible; keyboard focus and selection stay in place');
    await capture('everyday-astra',1320,880,'22');
    await page.locator('#preferences-continue').click(); await page.locator('#ready-stage:not([hidden])').waitFor();
    assert.equal(await page.locator('#terms-reader').isVisible(), true, 'Preferences advances to the current Terms step');
    const preferences = await page.evaluate(() => window.strategistDesktop.getWorkspacePreferences());
    assert.equal(preferences.aiPlan,'everyday'); assert.equal(preferences.advancedIntelligence,true); assert.equal(preferences.preferredProvider,'ollama');
    assert.equal(preferences.paid,undefined);
    await page.locator('#ready-back').click(); await page.locator('#preferences-continue:enabled').waitFor();
    assert.equal(await page.locator('#preferences-plan-everyday').isChecked(),true); assert.equal(await page.locator('#preferences-astra').isChecked(),true);
    await page.emulateMedia({ reducedMotion:'reduce' });
    await page.locator('#preferences-back').click(); await page.locator('#configure-continue').click(); await page.locator('#preferences-continue:enabled').waitFor();
    assert.equal(await page.evaluate(() => document.getAnimations().filter(a => a.effect?.target?.classList?.contains('entry-stage')).length),0);
    assert.equal(await app.evaluate(() => process._getActiveHandles().filter(h => h.constructor?.name === 'Server' && h.listening).length),0);
    assert.match(readFileSync(join(folder,'CASE-DETAILS.md'),'utf8'), /For interface verification only/);
    assert.deepEqual(errors,[]);
    checks.push('Native save/Back retains plans and Astra without a paid entitlement, a provider connection or a case service; reduced motion respected');
    console.log(JSON.stringify({ checks, layouts:layouts.length, profile },null,2));
  } catch(error) { console.error(error); process.exitCode=1; if(page && !page.isClosed()) await page.screenshot({path:join(output,'plans-error.png')}).catch(()=>{}); }
  finally { writeFileSync(join(output,`plans-${version}-verification.json`),JSON.stringify({checks,layouts,errors,profile,testedAt:new Date().toISOString()},null,2)); if(app) await app.close(); }
})();
