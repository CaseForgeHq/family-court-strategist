// Render and exercise the actual app in Electron using fictional records and
// an explicitly simulated analysis provider. No user profile or AI account.
const {app,BrowserWindow}=require('electron');
const {mkdtempSync,mkdirSync,writeFileSync}=require('node:fs');
const {join,resolve}=require('node:path');
const {pathToFileURL}=require('node:url');
const assert=require('node:assert/strict');
const repo=resolve(__dirname,'../..'),out=join(repo,'output/files-ai-native');
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
  const geometry=await win.webContents.executeJavaScript(`({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight,controls:[...document.querySelectorAll('.files-ai-toolbar button,.desk-toolbar .btn,.scan-card[open] .scan-actions button')].filter(el=>el.getBoundingClientRect().width).map(el=>({label:el.textContent.trim(),x:el.getBoundingClientRect().x,y:el.getBoundingClientRect().y,right:el.getBoundingClientRect().right,bottom:el.getBoundingClientRect().bottom}))})`);
  assert.ok(geometry.scrollWidth<=geometry.width+2,`${name}: horizontal page overflow`);assert.ok(geometry.scrollHeight<=geometry.height+2,`${name}: vertical page overflow`);
  for(const c of geometry.controls)assert.ok(c.x>=-1 && c.right<=width+1 && c.y>=-1 && c.bottom<=height+1,`${name}: clipped ${c.label}`);
  writeFileSync(join(out,`${name}.png`),(await win.webContents.capturePage()).toPNG());shots.push({name,...geometry});
}
(async()=>{
  await app.whenReady();
  const {createServer}=await import(pathToFileURL(join(repo,'app/server.js')).href);
  server=createServer(caseFolder,{preview:true,scanDocument:async()=>({}),analyseDocument:async({record,extraction,signal})=>{
    if(hold)await new Promise((resolve,reject)=>{releases.push(resolve);signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});
    return {complete:true,summary:'A fictional school update records a meeting and the sender’s account. The source supports what was written, not independent verification of the event.',attention:[],context:{documentType:'Fictional school letter',regions:['Commonwealth','QLD']},jurisdiction:{country:'AU',regions:['Commonwealth','QLD']},findings:[{id:'fixture-fact',kind:'claim',title:'A meeting was reported',detail:'Alex stated that the meeting took place on 1 June 2026.',strength:'limited',limitations:'This is the sender’s account within one document.',sources:[{page:1,quote:extraction.pages[0].text,speaker:'Alex',recipient:'Sam',reportingSource:'Fictional letter',sequence:'1',sourceMatch:'text_match',anchor:{kind:'paragraph',paragraph:1,label:'Paragraph 1'}}]}],laws:[],legalLimitations:[],coverage:extraction.coverage,sourcePages:extraction.pages,sourceImages:[],model:'Simulated provider for UI verification',effort:'low',usage:[]};
  }});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const docs=[];for(let i=0;i<16;i++)docs.push((await server.inbox.import(caseFolder,`Fictional ${String(i+1).padStart(2,'0')} — school update.txt`,Buffer.from(`Alex wrote to Sam: The meeting took place on 1 June 2026. Fictional record ${i+1}.`))).document);
  await server.inbox.enqueue(caseFolder,docs[0].id);await server.inbox.tail;
  win=new BrowserWindow({show:false,width:1400,height:950,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
  win.webContents.on('console-message',(_event,level,message)=>{if(level>=3)errors.push(message);});
  await win.loadURL(`http://127.0.0.1:${server.address().port}`);await until(`document.querySelectorAll('[data-scan-document]').length===16`);
  await capture('case-desk-day',1380,890);await capture('case-desk-compact',804,619,true);
  hold=true;for(let i=1;i<7;i++)await server.inbox.enqueue(caseFolder,docs[i].id);
  await win.webContents.executeJavaScript(`document.querySelector('[data-scan-document="${docs[0].id}"]').click()`);
  await until(`document.querySelector('.scan-card[open] .scan-report')`);
  await capture('scan-report-day',1380,890);await capture('scan-report-compact',804,619,true);
  await win.webContents.executeJavaScript(`document.querySelector('.scan-card[open] [data-section="facts"]').open=true`);
  await until(`document.querySelector('.scan-card[open] [data-source-document]')`);
  await win.webContents.executeJavaScript(`document.querySelector('.scan-card[open] [data-source-document]').click()`);
  await until(`document.querySelector('.source-modal')?.textContent.includes('Alex wrote')`);
  await capture('source-compact',804,619,true);
  await win.webContents.executeJavaScript(`document.querySelector('#modal-x').click();document.querySelector('.scan-card[open]').open=false;document.querySelector('.scan-card-list').scrollTop=0`);
  await capture('queue-compact',804,619);await capture('queue-desktop',1380,890);
  const text=await win.webContents.executeJavaScript(`document.querySelector('#view').textContent`);assert.match(text,/Scan scheduled/);assert.match(text,/Scan in progress/);assert.match(text,/Scan completed/);
  assert.equal(errors.length,0,errors.join('\n'));
  writeFileSync(join(out,'report.json'),JSON.stringify({simulatedAI:true,shots,errors},null,2));console.log(JSON.stringify({ok:true,captures:shots.length,output:out}));
})().catch(async error=>{console.error(error.stack);const ui=win && !win.isDestroyed() ? await win.webContents.executeJavaScript(`({view:document.querySelector('#view')?.innerHTML,message:document.querySelector('#inbox-message')?.textContent,buttons:[...document.querySelectorAll('[data-scan-document]')].map(b=>({text:b.textContent,dataset:{...b.dataset}}))})`).catch(()=>null):null;writeFileSync(join(out,'failure.json'),JSON.stringify({error:error.message,shots,errors,ui},null,2));process.exitCode=1;}).finally(async()=>{win?.destroy();await server?.closeWorkspace();if(server)await new Promise(r=>server.close(r));app.exit(process.exitCode || 0);});
