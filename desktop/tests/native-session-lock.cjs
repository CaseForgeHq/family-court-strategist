const {_electron}=require(process.env.PLAYWRIGHT_MODULE);
const {mkdtempSync,mkdirSync,writeFileSync,readFileSync}=require('node:fs');
const {join,resolve}=require('node:path');
const assert=require('node:assert/strict');
const {PinSecurity}=require('../security.cjs');
const {createWorkspacePreferences}=require('../workspace-preferences.cjs');
const {createTermsAcceptance}=require('../terms-acceptance.cjs');
const root=resolve(__dirname,'../..'),out=join(root,'output/session-lock-native');mkdirSync(out,{recursive:true});
const profile=mkdtempSync(join(out,'profile-')),folder=join(profile,'Fictional saved case');mkdirSync(folder);
writeFileSync(join(folder,'CASE-DETAILS.md'),'# Fictional saved case\n');
writeFileSync(join(folder,'saved-record.txt'),'Fictional saved evidence.');
const pin='739482';new PinSecurity(join(profile,'app-lock.json')).setup(pin,pin);
const verifier=readFileSync(join(profile,'app-lock.json'),'utf8');
writeFileSync(join(profile,'config.json'),JSON.stringify({vault:folder}));
createWorkspacePreferences(join(profile,'workspace-preferences.json')).set(folder,{caseName:'Fictional saved case',preferredProvider:'ollama'});
const terms=createTermsAcceptance(join(profile,'terms-acceptance.json'));terms.accept({...terms.get(),accepted:true});
let app;
async function launch(){const env={...process.env,CASEFORGE_TEST_USER_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;app=await _electron.launch({args:[join(root,'desktop/main.cjs')],executablePath:join(root,'desktop/node_modules/electron/dist/electron.exe'),env});const page=await app.firstWindow();page.on('pageerror',e=>console.error('RENDERER',e.message));await page.waitForURL('caseforge://lock/lock.html');return page;}
async function enter(page,value){await page.locator('#pin').fill(value);await page.locator('#pin').press('Enter');}
(async()=>{
 let page=await launch();assert.equal(await page.locator('#lock-title').textContent(),'Unlock Case Forge');
 await enter(page,'999999');await page.locator('#lock-message').filter({hasText:'not recognised'}).waitFor();assert.ok(page.url().startsWith('caseforge:'));
 await enter(page,pin);await page.waitForURL(/127\.0\.0\.1/);await page.waitForFunction(()=>document.body.dataset.workspaceView==='dashboard');await page.locator('[data-view="documents"]').click();
 await page.waitForFunction(()=>document.body.dataset.workspaceView==='documents');
 await assert.doesNotReject(async()=>{for(let i=0;i<50;i++){if(JSON.parse(readFileSync(join(profile,'config.json'))).view==='documents')return;await new Promise(r=>setTimeout(r,100));}throw Error('Navigation did not persist the page');});

 const nextWindow=app.waitForEvent('window');await page.locator('#lock-app').click();page=await nextWindow;await page.waitForURL('caseforge://lock/lock.html');
 assert.equal(await page.evaluate(()=>window.strategistDesktop.rememberView('notebook')),false);
 assert.deepEqual(await page.evaluate(()=>window.strategistDesktop.getSetupState()),{error:'Access denied.'});
 const handles=await app.evaluate(()=>process._getActiveHandles().filter(h=>h.constructor?.name==='Server'&&h.listening).length);assert.equal(handles,0);
 await page.screenshot({path:join(out,'locked.png')});
 await enter(page,pin);await page.waitForURL(/#documents$/);await page.locator('#scan-card-list').waitFor();
 await app.close();app=null;
 page=await launch();await enter(page,pin);await page.waitForURL(/#documents$/);await page.locator('#scan-card-list').waitFor();
 assert.equal(readFileSync(join(folder,'saved-record.txt'),'utf8'),'Fictional saved evidence.');
 assert.equal(JSON.parse(readFileSync(join(profile,'config.json'))).view,'documents');
 assert.ok(!readFileSync(join(profile,'app-lock.json'),'utf8').includes(pin));
 await page.screenshot({path:join(out,'restored.png')});
 console.log(JSON.stringify({ok:true,wrongPinRejected:true,lockedApiDenied:true,caseAndViewRestoredAfterLockAndRestart:true,profile}));
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{if(app)await app.close();});
