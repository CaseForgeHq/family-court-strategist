// Fictional bridge for the native chat harness. No credentials, network or AI.
const {contextBridge}=require('electron');
const statusListeners=new Set(),progressListeners=new Set();
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let state={available:true,connected:false,signingIn:false,busy:false,checking:false,state:'signed_out',activeScans:0},mode='normal',active=null;
const metrics={login:0,cancelLogin:0,logout:0,chats:[],cancel:0,newConversation:0,openedLinks:[],progress:[]};
const answer='**Fictional streamed answer.**\n\n- Read the source.\n- Check the date.\n\n<script>window.chatInjection=true</script>\n\n[Safe source](https://example.com/fictional) and [Unsafe source](javascript:evil).';
function publish(patch){state={...state,...patch};for(const listener of statusListeners)listener({...state});return {...state};}
function progress(value){metrics.progress.push({...value});for(const listener of progressListeners)listener({...value});}
function listen(set,callback){set.add(callback);return()=>set.delete(callback);}
function cancel(){metrics.cancel++;if(active){active.cancelled=true;active.finish({error:'Fictional request cancelled.'});}return {ok:true};}
contextBridge.exposeInMainWorld('strategistDesktop',Object.freeze({
  getAppInfo:async()=>({name:'Case Forge',version:'native-chat-fixture'}),
  chatGPTStatus:async()=>({...state}),
  onChatGPTStatus:callback=>listen(statusListeners,callback),
  onChatGPTProgress:callback=>listen(progressListeners,callback),
  chatGPTLogin:async()=>{metrics.login++;return publish({connected:false,signingIn:true,state:'signing_in',error:null});},
  chatGPTCancelLogin:async()=>{metrics.cancelLogin++;return publish({connected:false,signingIn:false,state:'signed_out',error:null});},
  chatGPTLogout:async()=>{metrics.logout++;return publish({connected:false,signingIn:false,state:'signed_out',email:null,plan:null,error:null});},
  chatGPTNewConversation:async()=>{metrics.newConversation++;return {ok:true};},
  chatGPTOpenLink:async url=>{metrics.openedLinks.push(url);return {ok:true};},
  chatGPTCancel:async()=>cancel(),
  chatGPTChat:({text,requestId})=>{
    metrics.chats.push({text,requestId});
    return new Promise(resolve=>{
      const job={cancelled:false,finish:value=>{if(active===job)active=null;resolve(value);}};active=job;
      void(async()=>{
        progress({requestId,phase:'connecting'});await wait(100);if(job.cancelled)return;
        progress({requestId,phase:'replying'});
        const chunks=mode==='stop'?['Fictional partial reply','Fictional partial reply that should be stopped.']:mode==='overwrite'?['I will think through this fictional record.','A fictional reply','A fictional reply replaces the progress commentary.']:[answer.slice(0,20),answer.slice(0,66),answer];
        for(const text of chunks){if(job.cancelled)return;progress({requestId,phase:'delta',text});await wait(mode==='stop'?1500:500);}
        if(job.cancelled)return;progress({requestId,phase:'completed'});job.finish({text:chunks.at(-1),model:'Simulated UI fixture'});
      })().catch(error=>job.finish({error:error.message}));
    });
  }
}));
contextBridge.exposeInMainWorld('caseForgeChatFixture',Object.freeze({
  completeSignIn:()=>publish({connected:true,signingIn:false,state:'connected',email:'fictional-reviewer@example.invalid',plan:'Fictional plan',error:null}),
  setMode:value=>{mode=value;},
  snapshot:()=>JSON.parse(JSON.stringify({state,metrics,answer,simulatedAI:true}))
}));
