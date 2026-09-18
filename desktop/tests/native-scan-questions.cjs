// Render and exercise the actual app in Electron using fictional records and
// an explicitly simulated analysis provider. No user profile or AI account.
const {app,BrowserWindow}=require('electron');
const {mkdtempSync,mkdirSync,writeFileSync}=require('node:fs');
const {join,resolve}=require('node:path');
const {pathToFileURL}=require('node:url');
const assert=require('node:assert/strict');
const repo=resolve(__dirname,'../..'),out=join(repo,'output/scan-clean-review');
mkdirSync(out,{recursive:true});
const profile=mkdtempSync(join(out,'profile-')),caseFolder=join(profile,'Fictional case');mkdirSync(caseFolder);
app.setPath('userData',profile);app.commandLine.appendSwitch('disable-gpu');
let server,win;
const shots=[],errors=[],releases=[];let hold=false;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(expression){for(let i=0;i<150;i++){if(await win.webContents.executeJavaScript(expression))return;await pause(40);}throw new Error('UI did not reach '+expression);}
async function capture(name,width,height,night=false){
  win.setContentSize(width,height);await pause(180);
  await win.webContents.executeJavaScript(`window.CaseForgeScene?.update(new Date(${JSON.stringify(night?'2026-09-17T23:00:00+10:00':'2026-09-17T12:00:00+10:00')}));document.documentElement.dataset.sceneMode=${JSON.stringify(night?'dark':'light')};document.body.dataset.sceneMode=${JSON.stringify(night?'dark':'light')};for(const animation of document.getAnimations())try{animation.finish()}catch{}`);
  await pause(150);
  const geometry=await win.webContents.executeJavaScript(`({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight,controls:[...document.querySelectorAll('.files-ai-intro button,.desk-toolbar .btn')].filter(el=>el.getBoundingClientRect().width).map(el=>({label:el.textContent.trim(),x:el.getBoundingClientRect().x,y:el.getBoundingClientRect().y,right:el.getBoundingClientRect().right,bottom:el.getBoundingClientRect().bottom}))})`);
  if(await win.webContents.executeJavaScript(`!!document.querySelector('.scan-card')`)) {
    const glass=await win.webContents.executeJavaScript(`(()=>{const probe=document.createElement('div');probe.className='case-desk intake-shortcut';document.querySelector('.content').append(probe);const card=document.querySelector('.scan-card');const keys=['backgroundImage','backgroundColor','borderTopColor','borderTopWidth','borderRadius','boxShadow','backdropFilter'];const result=keys.map(k=>[k,getComputedStyle(probe)[k],getComputedStyle(card)[k]]);probe.remove();return result})()`);
    for(const [key,desk,card] of glass)assert.equal(card,desk,key);
    const row=await win.webContents.executeJavaScript(`(()=>{const card=document.querySelector('.scan-card'),list=card.parentElement;return {right:card.getBoundingClientRect().right,buttonRight:document.querySelector('.files-ai-intro > button').getBoundingClientRect().right,weights:[...card.querySelectorAll('.file-reference,.scan-card-name strong,.scan-card-status,.scan-card-type')].map(el=>getComputedStyle(el).fontWeight),width:card.getBoundingClientRect().width,available:list.clientWidth,sizes:[...card.querySelectorAll('.file-reference,.scan-card-name strong,.scan-card-status,.scan-card-type')].map(el=>getComputedStyle(el).fontSize)}})()`);
    assert.ok(Math.abs(row.right-row.buttonRight)<=1,JSON.stringify(row));assert.ok(row.weights.every(w=>w==='500'),JSON.stringify(row));assert.ok(Math.abs(row.width-row.available)<=1,JSON.stringify(row));assert.ok(row.sizes.every(size=>size==='15px'),JSON.stringify(row));
  }
  assert.ok(geometry.scrollWidth<=geometry.width+2,`${name}: horizontal page overflow`);assert.ok(geometry.scrollHeight<=geometry.height+2,`${name}: vertical page overflow`);
  for(const c of geometry.controls)assert.ok(c.x>=-1 && c.right<=width+1 && c.y>=-1 && c.bottom<=height+1,`${name}: clipped ${c.label}`);
  writeFileSync(join(out,`${name}.png`),(await win.webContents.capturePage()).toPNG());shots.push({name,...geometry});
}
(async()=>{
  await app.whenReady();
  const {SCAN_QUESTIONS}=await import(pathToFileURL(join(repo,'app/public/scan-questions.js')).href);
  const {createServer}=await import(pathToFileURL(join(repo,'app/server.js')).href);
  server=createServer(caseFolder,{preview:true,scanDocument:async()=>({}),analyseDocument:async({record,extraction,signal})=>{
    if(hold)await new Promise((resolve,reject)=>{releases.push(resolve);signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});
    return {questionAnswers:SCAN_QUESTIONS.map(q=>({...q,status:q.id==='facts'?'answered':'no_findings',answer:q.id==='facts'?'Alex reports a meeting on 1 June 2026. This is an attributed claim.':'No material finding is identified for this question in the supplied fictional letter.',findingIds:q.id==='facts'?['fixture-fact']:[],lawIndexes:[],limitations:'This letter alone does not independently establish what occurred.',followUp:'Check the original meeting record if the date is disputed.'})),complete:true,summary:'A fictional school update records a meeting and the sender’s account. The source supports what was written, not independent verification of the event.',attention:[],context:{documentType:'Fictional school letter',regions:['Commonwealth','QLD']},jurisdiction:{country:'AU',regions:['Commonwealth','QLD']},findings:[{id:'fixture-fact',kind:'claim',title:'A meeting was reported',detail:'Alex stated that the meeting took place on 1 June 2026.',strength:'limited',limitations:'This is the sender’s account within one document.',sources:[{page:1,quote:extraction.pages[0].text,speaker:'Alex',recipient:'Sam',reportingSource:'Fictional letter',sequence:'1',sourceMatch:'text_match',anchor:{kind:'paragraph',paragraph:1,label:'Paragraph 1'}}]}],laws:[],legalLimitations:[],coverage:extraction.coverage,sourcePages:extraction.pages,sourceImages:[],model:'Simulated provider for UI verification',effort:'low',usage:[]};
  }});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const docs=[];for(let i=0;i<16;i++)docs.push((await server.inbox.import(caseFolder,`Fictional ${String(i+1).padStart(2,'0')} — school update.txt`,Buffer.from(`Alex wrote to Sam: The meeting took place on 1 June 2026. Fictional record ${i+1}.`))).document);
  await server.inbox.enqueue(caseFolder,docs[0].id);await server.inbox.tail;
  win=new BrowserWindow({show:false,width:1400,height:950,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
  win.webContents.on('console-message',(_event,level,message)=>{if(level>=3)errors.push(message);});
  await win.loadURL(`http://127.0.0.1:${server.address().port}`);await until(`document.querySelectorAll('[data-scan-document]').length===16`);
  await capture('case-desk-day',1380,890);await capture('case-desk-compact',804,619,true);
  hold=true;
  await win.webContents.executeJavaScript(`document.querySelector('[data-scan-document="${docs[0].id}"]').click()`);
  await until(`document.querySelector('.scan-card[open] .scan-report')`);
  await capture('scan-report-day',1380,890);
  await capture('scan-report-reference',1300,760);
  await win.webContents.executeJavaScript(`window.scanPreviewCard=document.querySelector('.scan-card[open]');window.scanPreviewCard.open=false;document.querySelector('.scan-card-list').scrollTop=0`);
  await capture('files-only-reference',1295,868);
  await win.webContents.executeJavaScript(`window.scanPreviewCard.open=true;document.querySelector('.scan-card-list').scrollTop=0`);await capture('scan-report-compact',804,619,true);
  await win.webContents.executeJavaScript(`document.querySelector('.scan-card[open] [data-question-target="facts"]').click()`);
  assert.ok(await win.webContents.executeJavaScript(`document.activeElement===document.querySelector('[data-section="facts"] > h3') && !document.querySelector('.scan-report details')`));
  await capture('mapped-answer-compact',804,619,true);
  assert.ok(await win.webContents.executeJavaScript(`(()=>{const card=document.querySelector('.scan-card[open]'), heading=card.querySelector('.scan-card-heading');return getComputedStyle(heading).position==='static' && getComputedStyle(document.querySelector('.scan-card-list')).borderRadius==='14px' && heading.getBoundingClientRect().bottom < document.querySelector('[data-section="facts"]').getBoundingClientRect().top})()`));
  await until(`document.querySelector('.scan-card[open] [data-source-document]')`);
  await win.webContents.executeJavaScript(`document.querySelector('.scan-card[open] [data-source-document]').click()`);
  await until(`document.querySelector('.source-modal')?.textContent.includes('Alex wrote')`);
  await capture('source-compact',804,619,true);
  await win.webContents.executeJavaScript(`document.querySelector('#modal-x').click();document.querySelector('.scan-card[open]').open=false;document.querySelector('.scan-card-list').scrollTop=0`);
  for(let i=1;i<7;i++)await server.inbox.enqueue(caseFolder,docs[i].id);await pause(3000);await capture('queue-compact',804,619);await capture('queue-desktop',1380,890);
  const text=await win.webContents.executeJavaScript(`document.querySelector('#view').textContent`);assert.match(text,/Scan scheduled/);assert.match(text,/Scan in progress/);assert.match(text,/Scan completed/);
  const {DEMO_PRESETS}=await import(pathToFileURL(join(repo,'app/lib/demo-data.js')).href);
  await win.webContents.executeJavaScript(`(async()=>{const {createAdmin}=await import('/admin.js');createAdmin({desktop:{adminStatus:async()=>({presets:${JSON.stringify(DEMO_PRESETS)},entries:[],canReturn:false})}});document.querySelector('#open-admin').click()})()`);
  await until(`document.querySelector('[name="demo-size"][value="review"]')`);
  await win.webContents.executeJavaScript(`document.querySelector('[name="demo-size"][value="review"]').click()`);
  await capture('review-test-picker',804,619);
  assert.ok(await win.webContents.executeJavaScript(`(()=>{const dialog=document.querySelector('.admin-dialog[open]');return dialog.scrollWidth<=dialog.clientWidth+1 && dialog.querySelector('.admin-preview').textContent.includes('No pre-filled findings')})()`));
  assert.equal(errors.length,0,errors.join('\n'));
  writeFileSync(join(out,'report.json'),JSON.stringify({simulatedAI:true,shots,errors},null,2));console.log(JSON.stringify({ok:true,captures:shots.length,output:out}));
})().catch(async error=>{console.error(error.stack);const ui=win && !win.isDestroyed() ? await win.webContents.executeJavaScript(`({view:document.querySelector('#view')?.innerHTML,message:document.querySelector('#inbox-message')?.textContent,buttons:[...document.querySelectorAll('[data-scan-document]')].map(b=>({text:b.textContent,dataset:{...b.dataset}}))})`).catch(()=>null):null;writeFileSync(join(out,'failure.json'),JSON.stringify({error:error.message,shots,errors,ui},null,2));process.exitCode=1;}).finally(async()=>{win?.destroy();await server?.closeWorkspace();if(server)await new Promise(r=>server.close(r));app.exit(process.exitCode || 0);});
