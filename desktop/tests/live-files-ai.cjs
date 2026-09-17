// Explicit opt-in only: real signed-in ChatGPT, fictional isolated case data.
const {createChatGPT}=require('../chatgpt.cjs');
const {createCanvas}=require('../../app/node_modules/@napi-rs/canvas');
const {mkdtempSync,mkdirSync,writeFileSync}=require('node:fs');
const {join,resolve}=require('node:path');
const {pathToFileURL}=require('node:url');
const repo=resolve(__dirname,'../..'),out=join(repo,'output/files-ai-live');mkdirSync(out,{recursive:true});
const bridge=createChatGPT({profileDir:join(process.env.APPDATA,'family-court-strategist-desktop','chatgpt'),runtimePath:join(repo,'desktop/runtime/codex.exe'),openExternal:async()=>{throw new Error('Sign in through Case Forge first.');}});
let server,active=0,maxActive=0,imageCalls=0;const calls=[];
(async()=>{
  const status=await bridge.status();
  const connection={available:status.available,connected:status.connected,error:status.error || null};
  writeFileSync(join(out,'connection.json'),JSON.stringify(connection,null,2));console.log(JSON.stringify({connection}));
  if(!status.connected || process.env.CASE_FORGE_LIVE_SCAN!=='1')return;
  const root=mkdtempSync(join(out,'fictional-case-'));
  const {createServer}=await import(pathToFileURL(join(repo,'app/server.js')).href);
  server=createServer(root,{preview:true,scanDocument:async(request,options)=>{
    active++;maxActive=Math.max(maxActive,active);if(request.images?.length)imageCalls++;
    const entry={requestId:request.requestId,images:request.images?.length || 0,startedAt:new Date().toISOString()};calls.push(entry);
    try{const result=await bridge.scan(request,options);Object.assign(entry,{model:result.model,effort:result.effort,usage:result.usage,completedAt:new Date().toISOString()});return result;}
    catch(error){entry.error=error.message;throw error;}finally{active--;}
  }});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${server.address().port}`,session=await(await fetch(base+'/api/session')).json();
  const headers={'content-type':'application/json','x-strategist-token':session.token,'x-case-id':session.caseKey};
  const post=async(path,body)=>{const response=await fetch(base+path,{method:'POST',headers,body:JSON.stringify(body)});const value=await response.json();if(!response.ok)throw new Error(value.error || `HTTP ${response.status}`);return value;};
  await post('/api/scan-settings',{country:'AU',regions:['Commonwealth','QLD'],confirmed:true});
  const canvas=createCanvas(1200,420),ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,1200,420);ctx.fillStyle='#111';ctx.font='30px Arial';
  ['FICTIONAL SOFTWARE TEST: COLOUR NOTE','Written in Brisbane, Queensland, Australia, 17 September 2026.','The palette contains blue and green.','This is a fictional visual design sample, with no real people.'].forEach((line,i)=>ctx.fillText(line,35,70+i*85));
  const fixtures=[['fictional-colour-note.txt',Buffer.from('Fictional software test: internal design note.\nWritten in Brisbane, Queensland, Australia, 17 September 2026.\nThe palette contains blue and green.\nThis is a fictional visual design sample, with no real people or actual dispute.')],['fictional-layout-note.txt',Buffer.from('Fictional software test: internal layout note.\nWritten in Brisbane, Queensland, Australia, 17 September 2026.\nThe sample layout contains two columns.\nThis is a fictional interface design sample, with no real people or actual dispute.')],['fictional-colour-image.png',canvas.toBuffer('image/png')]];
  const documents=[];
  for(const [filename,bytes] of fixtures){const response=await fetch(base+'/api/documents?name='+encodeURIComponent(filename),{method:'POST',headers:{...headers,'content-type':'application/octet-stream'},body:bytes});const imported=await response.json();if(!response.ok)throw new Error(imported.error || `Import failed: ${response.status}`);documents.push(imported.document);}
  await Promise.all(documents.map(d=>post(`/api/documents/${d.id}/scan`,{})));
  let last='',done=false;const deadline=Date.now()+15*60*1000;
  while(Date.now()<deadline){
    const response=await(await fetch(base+'/api/documents',{headers})).json(),list=response.documents || response;
    const state=list.map(d=>({name:d.name,state:d.scan?.state,stage:d.scan?.stage,error:d.scan?.error}));const key=JSON.stringify(state);
    if(key!==last){console.log(key);last=key;}
    if(state.every(d=>d.state&&!['queued','running'].includes(d.state))){done=true;break;}
    await new Promise(r=>setTimeout(r,1500));
  }
  const reports=[];for(const doc of documents){const detail=await server.inbox.detail(root,doc.id);reports.push({id:doc.id,name:doc.name,scan:detail.scan,reports:detail.reports.map(r=>({id:r.id,version:r.version,complete:r.complete,model:r.model,effort:r.effort,attention:r.attention,findings:r.findings?.length,coverage:r.coverage,path:r.path}))});}
  const result={liveAI:true,done,root,maxActive,imageCalls,calls,reports};writeFileSync(join(out,'report.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify({done,maxActive,imageCalls,states:reports.map(r=>r.scan?.state),output:out}));
  if(!done)throw new Error('Live scan deadline reached; unfinished jobs will be interrupted.');
})().catch(error=>{console.error(error.stack);process.exitCode=1;}).finally(async()=>{if(server){await server.closeWorkspace();await new Promise(r=>server.close(r));}bridge.close();});
