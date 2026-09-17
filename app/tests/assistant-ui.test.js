import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createAssistant } from '../public/assistant.js';
const until = async check => { for(let i=0;i<100;i++){if(check())return;await new Promise(r=>setTimeout(r,5));}assert.fail('AI panel did not settle'); };
function fixture(t) {
  const dom=new JSDOM('<div id="panel-ai"></div>',{url:'http://127.0.0.1'}), previous={window:globalThis.window,document:globalThis.document};
  globalThis.window=dom.window;globalThis.document=dom.window.document;dom.window.HTMLElement.prototype.scrollIntoView=()=>{};
  t.after(()=>{dom.window.close();Object.assign(globalThis,previous);});return dom;
}
test('AI panel sends only typed text, renders provider text safely and clears conversation on sign-out',async t=>{
  const dom=fixture(t),calls=[];
  const desktop={chatGPTStatus:async()=>({connected:true,email:'fictional@example.test',plan:'Plus'}),chatGPTLogin:async()=>({}),chatGPTLogout:async()=>({connected:false}),chatGPTChat:async value=>{calls.push(value);return {text:'<img src=x onerror=bad()> Fictional reply'};},chatGPTCancel:async()=>({cancelled:true})};
  createAssistant({desktop}).mount();await until(()=>!document.querySelector('#chat-send').disabled);
  document.querySelector('#chat-text').value='Help organise a folder.';document.querySelector('form').dispatchEvent(new dom.window.Event('submit',{cancelable:true}));
  await until(()=>document.querySelector('.ai-message.assistant'));
  assert.deepEqual(calls,[{text:'Help organise a folder.'}]);assert.equal(document.querySelector('#panel-ai img'),null);assert.match(document.querySelector('.ai-message.assistant').textContent,/Fictional reply/);
  document.querySelector('#chat-login').click();await until(()=>document.querySelector('.ai-messages').textContent.includes('cleared'));assert.equal(document.querySelectorAll('.ai-message').length,0);assert.equal(document.querySelector('#chat-send').disabled,true);
});
test('browser mode explains the desktop requirement and cannot send or sign in',t=>{
  fixture(t);createAssistant({desktop:null}).mount();assert.equal(document.querySelector('#chat-login').disabled,true);assert.equal(document.querySelector('#chat-send').disabled,true);assert.match(document.querySelector('.ai-status').textContent,/desktop app/);
});
