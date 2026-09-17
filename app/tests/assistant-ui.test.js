import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createAssistant, safeChatLink } from '../public/assistant.js';
import { getChatGPTConnection } from '../public/chatgpt-connection.js';

const until = async check => { for (let i=0; i<100; i++) { if (check()) return; await new Promise(resolve=>setTimeout(resolve,5)); } assert.fail('AI panel did not settle'); };
const connected = { available:true, connected:true, email:'fictional@example.invalid', plan:'Plus', checking:false, signingIn:false, state:'connected', error:null };
function fixture(t, options={}) {
  const dom=new JSDOM('<div id="panel-ai"></div>',{url:'http://127.0.0.1'}), previous={window:globalThis.window,document:globalThis.document};
  globalThis.window=dom.window; globalThis.document=dom.window.document;
  const calls=[], statusListeners=new Set(), progressListeners=new Set(); let state=options.state || connected;
  const desktop=options.browser ? null : {
    chatGPTStatus:async()=>state,
    onChatGPTStatus:listener=>{statusListeners.add(listener);return()=>statusListeners.delete(listener);},
    onChatGPTProgress:listener=>{progressListeners.add(listener);return()=>progressListeners.delete(listener);},
    chatGPTLogin:async()=>{calls.push({method:'login'});return{...state,signingIn:true};},
    chatGPTCancelLogin:async()=>{calls.push({method:'cancel-login'});return{...state,signingIn:false};},
    chatGPTLogout:async()=>{calls.push({method:'logout'});state={available:true,connected:false,signingIn:false,state:'signed_out'};return state;},
    chatGPTChat:async value=>{calls.push({method:'chat',value});return options.chat ? options.chat(value):{text:'Fictional reply.'};},
    chatGPTCancel:async()=>{calls.push({method:'cancel'});return{cancelled:true};},
    chatGPTNewConversation:async()=>{calls.push({method:'new'});return options.newConversation ? options.newConversation():{cleared:true};},
    chatGPTOpenLink:async value=>{calls.push({method:'link',value});return{opened:true};},
  };
  const loadComponent=async()=>{
    dom.window.customElements.define('deep-chat',class extends dom.window.HTMLElement {
      constructor(){super();this.attachShadow({mode:'open'}).innerHTML='<div contenteditable="true"></div>';this.clears=0;this.focuses=0;this.responses=[];}
      connectedCallback(){this.onComponentRender?.(this);}
      disableSubmitButton(value){this.submitDisabled=value;}
      clearMessages(){this.clears++;this.responses=[];}
      focusInput(){this.focuses++;}
      async send(body){
        this.signals={stopClicked:{},onOpen:()=>{this.opens=(this.opens||0)+1;},onClose:()=>{this.closes=(this.closes||0)+1;},onResponse:async value=>{this.responses.push(value);}};
        return this.connect.handler(body,this.signals);
      }
    });
  };
  const assistant=createAssistant({desktop,loadComponent});
  const connection=getChatGPTConnection(desktop);
  t.after(()=>{assistant.destroy();connection.dispose();dom.window.close();Object.assign(globalThis,previous);});
  return {dom,desktop,assistant,connection,calls,progressListeners,get chat(){return document.querySelector('deep-chat');},push(value){state={...state,...value};for(const listener of statusListeners)listener(value);},progress(value){for(const listener of progressListeners)listener(value);}};
}

test('assistant sends only the last typed message and bounded request ID through the local adapter',async t=>{
  const f=fixture(t);await f.assistant.mount();await until(()=>f.chat&&!f.chat.submitDisabled);
  await f.chat.send({messages:[{role:'ai',text:'Old conversation never resent'},{role:'user',text:'  Help organise a folder.  '}],files:[{name:'not-attached.pdf'}],caseData:'not-sent'});
  const request=f.calls.find(call=>call.method==='chat').value;
  assert.deepEqual(Object.keys(request).sort(),['requestId','text']);assert.equal(request.text,'Help organise a folder.');assert.match(request.requestId,/^[A-Za-z0-9._:-]{1,160}$/);
  assert.deepEqual(f.chat.responses,[{text:'Fictional reply.'}]);assert.equal(f.chat.opens,1);assert.equal(f.chat.closes,1);
  assert.equal(f.chat.remarkable.html,false);assert.equal(f.chat.remarkable.linkify,false);assert.equal(f.chat.requestBodyLimits.maxMessages,1);
  assert.equal(f.chat.shadowRoot.querySelector('[contenteditable]').getAttribute('aria-label'),'Message ChatGPT');
});

test('cumulative streaming is normalized into unique deltas, ignores other requests and appends the final suffix',async t=>{
  let resolveReply;
  const f=fixture(t,{chat:()=>new Promise(resolve=>{resolveReply=resolve;})});await f.assistant.mount();await until(()=>f.chat&&!f.chat.submitDisabled);
  const sending=f.chat.send({messages:[{text:'Fictional question'}]});await until(()=>resolveReply);
  const {requestId}=f.calls.find(call=>call.method==='chat').value;
  f.progress({requestId:'another-request',phase:'delta',text:'Private other answer'});
  for(const text of ['Fictional ','Fictional ','Fictional reply'])f.progress({requestId,phase:'delta',text});
  resolveReply({text:'Fictional reply.'});await sending;
  assert.equal(f.chat.responses.map(value=>value.text||'').join(''),'Fictional reply.');
  assert.equal(f.chat.responses.some(value=>value.text?.includes('Private')),false);assert.equal(f.progressListeners.size,0);
});

test('a different final answer overwrites streamed commentary instead of concatenating it',async t=>{
  let resolveReply;
  const f=fixture(t,{chat:()=>new Promise(resolve=>{resolveReply=resolve;})});await f.assistant.mount();await until(()=>!f.chat.submitDisabled);
  const sending=f.chat.send({messages:[{text:'Fictional question'}]});await until(()=>resolveReply);
  const {requestId}=f.calls.find(call=>call.method==='chat').value;
  f.progress({requestId,phase:'delta',text:'I will consider the supplied context.'});
  f.progress({requestId,phase:'completed',text:'The final answer is concise.'});
  resolveReply({text:'The final answer is concise.'});await sending;
  assert.deepEqual(f.chat.responses.at(-1),{text:'The final answer is concise.',overwrite:true});
  assert.equal(f.chat.responses.reduce((text,value)=>value.overwrite ? value.text : text+(value.text||''),''),'The final answer is concise.');
});

test('status push updates the assistant without manual polling and transport errors retain the conversation',async t=>{
  const f=fixture(t,{state:{available:true,connected:false,checking:false,signingIn:false,state:'signed_out'}});await f.assistant.mount();
  assert.equal(f.chat.submitDisabled,true);f.push(connected);
  assert.equal(f.chat.submitDisabled,false);assert.equal(document.querySelector('#chat-login').textContent,'Sign out');
  assert.equal(document.querySelector('.ai-connection').hidden,true);
  assert.equal(document.querySelector('.ai-session-menu').hidden,false);
  assert.equal(document.querySelector('.ai-chat-note'),null);
  await f.chat.send({messages:[{text:'Fictional question'}]});
  f.push({connected:false,email:null,state:'error',error:'Connection temporarily unavailable.'});
  assert.equal(f.chat.clears,0);assert.equal(f.connection.state.connected,true);assert.match(document.querySelector('.ai-status').textContent,/temporarily unavailable/);
  f.push({available:true,connected:false,email:null,state:'signed_out',error:null});
  assert.equal(f.chat.clears,1);assert.equal(f.chat.submitDisabled,true);
  assert.equal(document.querySelector('.ai-connection').hidden,false);
  assert.equal(document.querySelector('.ai-session-menu').hidden,true);
});

test('stop interrupts the matching reply and closes streaming without appending a late answer',async t=>{
  let resolveReply;
  const f=fixture(t,{chat:()=>new Promise(resolve=>{resolveReply=resolve;})});await f.assistant.mount();await until(()=>!f.chat.submitDisabled);
  const sending=f.chat.send({messages:[{text:'Fictional question'}]});await until(()=>resolveReply);
  await f.chat.signals.stopClicked.listener();resolveReply({text:'This late answer should not display.'});await sending;
  assert.equal(f.calls.filter(call=>call.method==='cancel').length,1);assert.deepEqual(f.chat.responses,[]);assert.equal(f.chat.closes,1);
  assert.match(document.querySelector('.ai-status').textContent,/Reply stopped/);assert.equal(f.progressListeners.size,0);
});

test('confirmed sign-out during a reply keeps history cleared and submission disabled after completion',async t=>{
  let resolveReply;
  const f=fixture(t,{chat:()=>new Promise(resolve=>{resolveReply=resolve;})});await f.assistant.mount();await until(()=>!f.chat.submitDisabled);
  const sending=f.chat.send({messages:[{text:'Fictional question'}]});await until(()=>resolveReply);
  f.push({available:true,connected:false,state:'signed_out',error:null});resolveReply({text:'Stale reply'});await sending;
  assert.equal(f.chat.clears,1);assert.deepEqual(f.chat.responses,[]);assert.equal(f.chat.submitDisabled,true);
});

test('sign-out during a failing reply does not insert its late error into cleared history',async t=>{
  let rejectReply;
  const f=fixture(t,{chat:()=>new Promise((_resolve,reject)=>{rejectReply=reject;})});await f.assistant.mount();await until(()=>!f.chat.submitDisabled);
  const sending=f.chat.send({messages:[{text:'Fictional question'}]});await until(()=>rejectReply);
  f.push({available:true,connected:false,state:'signed_out',error:null});rejectReply(new Error('Prior reply cancelled by logout'));await sending;
  assert.equal(f.chat.clears,1);assert.deepEqual(f.chat.responses,[]);assert.equal(f.chat.submitDisabled,true);
});

test('explicit sign-out clears visible history and a new conversation resets the provider first',async t=>{
  let resetDone;
  const f=fixture(t,{newConversation:()=>new Promise(resolve=>{resetDone=resolve;})});await f.assistant.mount();await until(()=>!f.chat.submitDisabled);
  await f.chat.send({messages:[{text:'Fictional question'}]});document.querySelector('#chat-new').click();await until(()=>resetDone);
  assert.equal(f.chat.clears,0);resetDone({cleared:true});await until(()=>f.chat.clears===1);
  assert.equal(f.calls.filter(call=>call.method==='new').length,1);
  document.querySelector('.ai-session-menu').open=true;
  document.querySelector('#chat-signout').click();await until(()=>f.chat.clears===2);
  assert.equal(f.calls.filter(call=>call.method==='logout').length,1);assert.equal(f.chat.submitDisabled,true);
  assert.equal(document.querySelector('.ai-session-menu').open,false);
});

test('browser mode disables sign-in and sending while rendering the chat component locally',async t=>{
  const f=fixture(t,{browser:true});await f.assistant.mount();
  assert.equal(document.querySelector('#chat-login').disabled,true);assert.equal(f.chat.submitDisabled,true);assert.match(document.querySelector('.ai-status').textContent,/desktop app/);
  await f.chat.send({messages:[{text:'Must not send'}]});assert.equal(f.calls.length,0);assert.match(f.chat.responses[0].error,/Sign in/);
});

test('pending conversation reset blocks sends and duplicate resets without clearing history early',async t=>{
  let finish;
  const f=fixture(t,{newConversation:()=>new Promise(resolve=>{finish=resolve;})});
  await f.assistant.mount();await until(()=>!f.chat.submitDisabled);
  await f.chat.send({messages:[{text:'Previous fictional question'}]});
  const button=document.querySelector('#chat-new');button.click();await until(()=>finish);
  assert.equal(f.chat.submitDisabled,true);assert.equal(button.disabled,true);
  assert.equal(document.querySelector('#chat-signout').disabled,true);
  button.dispatchEvent(new window.Event('click'));
  await f.chat.send({messages:[{text:'Must wait until reset finishes'}]});
  assert.equal(f.calls.filter(call=>call.method==='new').length,1);
  assert.equal(f.calls.filter(call=>call.method==='chat').length,1);
  assert.equal(f.chat.clears,0);
  finish({cleared:true});await until(()=>!f.chat.submitDisabled);
  assert.equal(f.chat.clears,1);assert.equal(button.disabled,false);
  await f.chat.send({messages:[{text:'New fictional question'}]});
  assert.deepEqual(f.chat.responses,[{text:'Fictional reply.'}]);
});

test('failed conversation reset retains history and re-enables the composer',async t=>{
  const f=fixture(t,{newConversation:async()=>({error:'Reset unavailable'})});
  await f.assistant.mount();await until(()=>!f.chat.submitDisabled);
  await f.chat.send({messages:[{text:'Previous fictional question'}]});
  document.querySelector('#chat-new').click();
  await until(()=>document.querySelector('.ai-status').textContent==='Reset unavailable');
  assert.equal(f.chat.clears,0);assert.equal(f.chat.submitDisabled,false);
  assert.equal(document.querySelector('#chat-new').disabled,false);
  assert.deepEqual(f.chat.responses,[{text:'Fictional reply.'}]);
});

test('rendered links require an explicit click and safe HTTP(S) target',async t=>{
  const f=fixture(t);await f.assistant.mount();
  for(const href of ['javascript:alert(1)','file:///C:/private.txt','https://user:secret@example.invalid'])assert.equal(safeChatLink(href),null);
  const link=document.createElement('a');link.href='https://example.invalid/fictional';link.textContent='Source';f.chat.shadowRoot.append(link);
  assert.equal(f.calls.some(call=>call.method==='link'),false);link.click();
  assert.deepEqual(f.calls.find(call=>call.method==='link'),{method:'link',value:'https://example.invalid/fictional'});
});
