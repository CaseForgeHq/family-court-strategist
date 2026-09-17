// Manual preview: real ChatGPT only after the user signs in and sends/scans.
// The stable ignored profile supports closing/reopening to verify sign-in.
const {app,BrowserWindow,ipcMain,shell}=require('electron');
const {mkdirSync,writeFileSync}=require('node:fs');
const {join,resolve}=require('node:path');
const {pathToFileURL}=require('node:url');
const {createChatGPT,safeExternalUrl}=require('../chatgpt.cjs');
const repo=resolve(__dirname,'../..'),out=join(repo,'output/ai-chat-preview'),profile=join(out,'profile'),caseFolder=join(out,'Fictional AI testing case');
mkdirSync(profile,{recursive:true});mkdirSync(caseFolder,{recursive:true});
app.setPath('userData',profile);
app.disableHardwareAcceleration();
const ownsPreview=app.requestSingleInstanceLock();
if(!ownsPreview)app.quit();
let win,server,base,bridge,closing=false;
app.on('second-instance',()=>{if(win&&!win.isDestroyed()){win.show();win.focus();}});
const allowed=event=>win&&!win.isDestroyed()&&event.sender===win.webContents&&event.senderFrame===win.webContents.mainFrame&&event.senderFrame?.url?.startsWith(base+'/');
async function stop(){if(closing)return;closing=true;bridge?.close();if(server){await server.closeWorkspace();await new Promise(r=>server.close(r));}app.exit(0);}
(async()=>{
  if(!ownsPreview)return;
  await app.whenReady();
  bridge=createChatGPT({profileDir:join(profile,'chatgpt'),runtimePath:join(repo,'desktop/runtime/codex.exe'),openExternal:url=>shell.openExternal(url),version:'AI testing preview'});
  const {createServer}=await import(pathToFileURL(join(repo,'app/server.js')).href);
  server=createServer(caseFolder,{preview:true,scanDocument:(request,options)=>bridge.scan(request,options)});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}`;
  await server.inbox.open(caseFolder);
  const existing=server.inbox.list(caseFolder);
  if(!existing.documents?.length && !Array.isArray(existing)) throw new Error('Preview document register was unavailable.');
  if((Array.isArray(existing)?existing:existing.documents).length===0) await server.inbox.import(caseFolder,'Fictional design note.txt',Buffer.from('Fictional software testing note. Written in Brisbane, Queensland, Australia on 17 September 2026. The design palette contains blue and green. This sample has no real people or legal dispute.'));
  win=new BrowserWindow({show:false,width:1380,height:890,minWidth:820,minHeight:650,title:'Case Forge — AI testing preview',webPreferences:{preload:join(__dirname,'preview-ai-chat-preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false}});
  const push=(channel,value)=>{if(win&&!win.isDestroyed())win.webContents.send(channel,value);};
  bridge.subscribe(value=>{push('chatgpt:status-changed',value);writeFileSync(join(out,'connection.json'),JSON.stringify({connected:value.connected,signingIn:value.signingIn,state:value.state,error:value.error||null},null,2));});
  const actions={status:()=>bridge.status(),login:()=>bridge.login(),logout:()=>bridge.logout(),'cancel-login':()=>bridge.cancelLogin(),chat:value=>bridge.chat(value,{onProgress:value=>push('chatgpt:progress',value)}),cancel:()=>bridge.cancel(),new:()=>bridge.newConversation(),link:value=>shell.openExternal(safeExternalUrl(value))};
  for(const [name,action] of Object.entries(actions))ipcMain.handle(`preview-chat:${name}`,async(event,value)=>{if(!allowed(event))return{error:'Access denied.'};try{return await action(value);}catch(error){return{error:error.message};}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',(event,url)=>{if(new URL(url).origin!==base)event.preventDefault();});
  win.webContents.on('page-title-updated',event=>event.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  win.webContents.session.webRequest.onBeforeRequest((details,callback)=>{const url=new URL(details.url);callback({cancel:!(['data:','blob:','devtools:'].includes(url.protocol)||url.origin===base)});});
  win.on('closed',()=>void stop());
  await win.loadURL(base);
  await win.webContents.executeJavaScript(`new Promise((resolve,reject)=>{let attempts=0;const timer=setInterval(()=>{if(document.querySelector('#desk-files')){clearInterval(timer);resolve();}else if(++attempts>200){clearInterval(timer);reject(new Error('Workspace did not load'));}},50);})`);
  await win.webContents.executeJavaScript(`window.dispatchEvent(new CustomEvent('caseforge:open-panel',{detail:{name:'ai'}}))`);
  win.show();win.focus();
  setTimeout(async()=>{if(win&&!win.isDestroyed())writeFileSync(join(out,'preview.png'),(await win.webContents.capturePage()).toPNG());},1800);
  writeFileSync(join(out,'preview.json'),JSON.stringify({pid:process.pid,profile,caseFolder,liveAI:true,automaticInference:false,installedAppChanged:false},null,2));
  console.log('AI testing preview ready. No AI request is sent until you send a message or select Scan.');
})().catch(error=>{console.error(error.stack);bridge?.close();app.exit(1);});
app.on('window-all-closed',()=>void stop());
