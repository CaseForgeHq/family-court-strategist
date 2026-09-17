const { reviewTerms } = require('./terms-helper.cjs');
// Full workspace UI check using a copied fictional case and an isolated PIN/profile.
const { _electron } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { mkdtempSync, cpSync, writeFileSync, mkdirSync } = require('node:fs');
const { join, resolve } = require('node:path');
const assert = require('node:assert/strict');
const { PinSecurity } = require('../security.cjs');
const { createWorkspacePreferences } = require('../workspace-preferences.cjs');
const root=resolve(__dirname,'../..'),output=join(root,'output/desktop-preview');
const version=require('../package.json').version;
mkdirSync(output,{ recursive:true });
const profile=mkdtempSync(join(output,'workspace-profile-')),folder=join(profile,'Example Case');
cpSync(join(root,'sample-case'),folder,{ recursive:true });
writeFileSync(join(profile,'config.json'),JSON.stringify({ vault:folder }));
writeFileSync(join(profile,'scene-preferences.json'),JSON.stringify({ cityId:'brisbane',weatherEnabled:false }));
const pin='739482';new PinSecurity(join(profile,'app-lock.json')).setup(pin,pin);
createWorkspacePreferences(join(profile,'workspace-preferences.json')).set(folder,{ caseName:'Example case',preferredProvider:'ollama',aiPlan:'free',advancedIntelligence:false });
const env={ ...process.env,CASEFORGE_TEST_USER_DATA:profile };delete env.ELECTRON_RUN_AS_NODE;
let app,page;const layouts=[],errors=[],failedAssets=[];
async function settle(){await page.evaluate(async()=>{await document.fonts.ready;await Promise.all(document.getAnimations().filter(a=>a.effect?.getComputedTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));});}
async function capture(name,width=1320,height=880,hour='12'){
  await app.evaluate(({BrowserWindow},size)=>BrowserWindow.getAllWindows()[0].setContentSize(...size),[width,height]);
  await page.waitForFunction(size=>innerWidth===size[0]&&innerHeight===size[1],[width,height]);
  await page.evaluate(hour=>window.CaseForgeScene.update(new Date(`2026-09-16T${hour}:00:00+10:00`)),hour);await settle();
  const layout=await page.evaluate(()=>{
    const b=el=>{const r=el.getBoundingClientRect();return { x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height };};
    const controls=['.side','.bar','#view','#toggle-navigation','#toggle-context','#ask-claude','.workspace-footer'].map(s=>document.querySelector(s)).filter(e=>e?.checkVisibility());
    return {width:innerWidth,height:innerHeight,pageWidth:document.documentElement.scrollWidth,pageHeight:document.documentElement.scrollHeight,contentWidth:document.getElementById('view').scrollWidth,contentClient:document.getElementById('view').clientWidth,mode:document.documentElement.dataset.sceneMode,controls:controls.map(b),font:getComputedStyle(document.body).fontFamily,headingFonts:Array.from(document.querySelectorAll('#view h2')).map(el=>getComputedStyle(el).fontFamily)};
  });layouts.push({name,...layout});
  assert.ok(layout.pageWidth<=width+1&&layout.pageHeight<=height+1,`${name}: page fits viewport`);
  assert.ok(layout.contentWidth<=layout.contentClient+1,`${name}: no horizontal content overflow ${layout.contentWidth}/${layout.contentClient}`);
  for(const control of layout.controls)assert.ok(control.x>=-1&&control.y>=-1&&control.right<=width+1&&control.bottom<=height+1,`${name}: chrome within viewport ${JSON.stringify(control)}`);
  assert.match(layout.font,/Quicksand/);
  for(const font of layout.headingFonts)assert.match(font,/Ubuntu/,`${name}: shared heading font`);
  await page.screenshot({path:join(output,`workspace-${version}-${name}.png`)});
}
(async()=>{
  try{
    app=await _electron.launch({executablePath:join(root,'desktop/node_modules/electron/dist/electron.exe'),args:[join(root,'desktop/main.cjs')],env,cwd:root,timeout:30000});
    assert.equal(await app.evaluate(({app})=>app.getPath('userData')),profile);
    page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400&&!r.url().includes('/api/'))failedAssets.push(r.url());});
    await page.locator('#pin:enabled').waitFor();await page.locator('#pin').fill(pin);await page.locator('#pin').press('Enter');
    await page.locator('#preferences-stage:not([hidden])').waitFor();await page.locator('#preferences-continue:enabled').click();
    await reviewTerms(page); await page.locator('#ready-open:enabled').waitFor();await page.locator('#ready-open').click();await page.waitForURL('http://127.0.0.1:*/');await page.locator('.workspace-welcome').waitFor();
    await page.waitForFunction(()=>window.CaseForgeScene?.getTimezone()==='Australia/Brisbane');
    assert.equal((await page.evaluate(()=>window.strategistDesktop.getScenePreferences())).cityId,'brisbane');
    await capture('home-day');await capture('home-night',1320,880,'22');
    await page.locator('#scene-toggle').click();await page.locator('#scene-panel:not([hidden])').waitFor();await capture('weather',1320,880,'22');await page.keyboard.press('Escape');
    assert.equal(await page.locator('#workspace-context').isVisible(),false);await page.locator('#toggle-context').click();assert.equal(await page.locator('#workspace-context').isVisible(),true);await page.keyboard.press('Escape');assert.equal(await page.locator('#workspace-context').isVisible(),false);assert.equal(await page.locator('#toggle-context').evaluate(el=>el===document.activeElement),true);
    await page.locator('[data-view="documents"]').click();await page.locator('#document-picker:enabled').waitFor({state:'attached'});
    await page.locator('#document-picker').setInputFiles({name:'Fictional notes.txt',mimeType:'text/plain',buffer:Buffer.from('Fictional record for UI verification only. A meeting took place on 16 September 2026.')});
    await page.locator('.document-item').filter({hasText:'Fictional notes.txt'}).waitFor();await capture('files-day');await capture('files-night',1320,880,'22');
    await page.locator('#inbox-connect').click();await page.locator('.connection-form').waitFor();await capture('ai-settings-night',1320,880,'22');await page.keyboard.press('Escape');
    await page.locator('[data-view="map"]').click();await page.locator('.case-map-svg').waitFor();await capture('map-night',1320,880,'22');
    await page.locator('[data-view="timeline"]').click();await page.locator('#search').fill('contact');await capture('timeline-day');
    for(const view of ['journal','tasks','evidence','patterns','people','exports','legal']){
      await page.evaluate(view=>document.querySelector(`[data-view="${view}"]`).click(),view);await page.waitForFunction(view=>document.body.dataset.workspaceView===view,view);await settle();
      assert.ok((await page.locator('#view').innerText()).trim().length>0,`${view}: content rendered`);
    }
    await page.locator('[data-view="settings"]').click();await page.locator('#home-folder-path').filter({hasText:'Example Case'}).waitFor();await capture('settings-day');await capture('settings-night',1320,880,'22');
    await page.locator('[data-action="configure-pin"]').click();await page.locator('#home-pin-form').waitFor();await capture('pin-modal-night',1320,880,'22');await page.locator('#home-pin-cancel').click();
    await page.locator('[data-view="dashboard"]').click();assert.equal(await page.locator('.notebook-tools[open],.more-tools[open]').count(),0);await capture('home-compact',1000,720);await capture('home-minimum',804,619);
    await page.locator('#toggle-navigation').click();assert.equal(await page.locator('#workspace-sidebar').isVisible(),false);await page.locator('#toggle-navigation').click();await page.locator('[data-view="map"]').click();await capture('map-minimum',804,619,'22');
    await page.locator('#toggle-context').click();await capture('overview-minimum',804,619,'22');await page.locator('#close-context').click();
    await page.emulateMedia({reducedMotion:'reduce'});await page.locator('[data-view="dashboard"]').click();assert.equal(await page.evaluate(()=>document.getAnimations().filter(a=>a.effect?.target?.id==='view').length),0);
    const lockedWindow=app.waitForEvent('window');await page.locator('#lock-app').click();page=await lockedWindow;await page.waitForURL('caseforge://lock/lock.html');assert.equal((await page.evaluate(()=>window.strategistDesktop.getSetupState())).error,'Access denied.');
    assert.deepEqual(errors,[]);assert.deepEqual(failedAssets,[]);
    console.log(JSON.stringify({version,layouts:layouts.length,checks:['Shared scene and saved timezone','Local fictional import','All workspace routes','PIN controls and native relock','Responsive chrome and reduced motion','No missing assets or renderer errors'],profile},null,2));
  }catch(error){console.error(error);process.exitCode=1;if(page&&!page.isClosed())await page.screenshot({path:join(output,'workspace-error.png')}).catch(()=>{});}
  finally{writeFileSync(join(output,`workspace-${version}-verification.json`),JSON.stringify({layouts,errors,failedAssets,profile},null,2));if(app)await app.close();}
})();
