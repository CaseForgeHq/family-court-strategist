import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { getChatGPTConnection } from '../public/chatgpt-connection.js';

const connected={available:true,connected:true,email:'fictional@example.invalid',plan:'plus',checking:false,signingIn:false,state:'connected',error:null};
function fixture(t, methods={}) {
  const dom=new JSDOM('',{url:'http://127.0.0.1'}),previous={window:globalThis.window,document:globalThis.document};
  globalThis.window=dom.window;globalThis.document=dom.window.document;
  let listener,unsubscribed=0,statusCalls=0;
  const desktop={chatGPTStatus:async()=>{statusCalls++;return{available:true,connected:false,signingIn:false,state:'signed_out'};},chatGPTLogin:async()=>({...connected,connected:false,signingIn:true}),onChatGPTStatus:callback=>{listener=callback;return()=>{listener=null;unsubscribed++;};},...methods};
  const connection=getChatGPTConnection(desktop);
  t.after(()=>{connection.dispose();dom.window.close();Object.assign(globalThis,previous);});
  return{connection,desktop,dom,push:value=>listener?.(value),get statusCalls(){return statusCalls;},get unsubscribed(){return unsubscribed;}};
}

test('chat and scan surfaces share live authoritative status with no poll or browser credential storage',t=>{
  const f=fixture(t),first=[],second=[];
  assert.equal(getChatGPTConnection(f.desktop),f.connection);
  const off=f.connection.subscribe(value=>first.push(value));f.connection.subscribe(value=>second.push(value));
  f.push(connected);assert.equal(first.at(-1).connected,true);assert.equal(second.at(-1).email,'fictional@example.invalid');assert.equal(f.statusCalls,0);
  assert.equal(f.dom.window.localStorage.length,0);assert.equal(f.dom.window.sessionStorage.length,0);
  off();f.push({...connected,plan:'pro'});assert.equal(first.at(-1).plan,'plus');assert.equal(second.at(-1).plan,'pro');
});

test('concurrent refreshes share a request and a stale pre-login response cannot undo successful sign-in',async t=>{
  let resolveStatus,checks=0;
  const f=fixture(t,{chatGPTStatus:()=>{checks++;return new Promise(resolve=>{resolveStatus=resolve;});},chatGPTLogin:async()=>connected});
  const one=f.connection.refresh(),two=f.connection.refresh();assert.equal(checks,1);
  await f.connection.login();assert.equal(f.connection.state.connected,true);
  resolveStatus({available:true,connected:false,state:'signed_out'});await Promise.all([one,two]);
  assert.equal(f.connection.state.connected,true);assert.equal(f.connection.state.email,'fictional@example.invalid');
});

test('an account push wins over a stale login result or stale login failure',async t=>{
  let complete;
  const f=fixture(t,{chatGPTLogin:()=>new Promise((resolve,reject)=>{complete={resolve,reject};})});
  const login=f.connection.login();f.push(connected);complete.resolve({connected:false,signingIn:true});await login;
  assert.equal(f.connection.state.connected,true);assert.equal(f.connection.state.signingIn,false);
  const retry=f.connection.login();f.push({...connected,plan:'pro'});complete.reject(new Error('Old sign-in error'));await retry;
  assert.equal(f.connection.state.error,null);assert.equal(f.connection.state.plan,'pro');assert.equal(f.connection.state.changing,false);
});

test('temporary status errors preserve the known account while confirmed sign-out clears it',async t=>{
  let fail=true;
  const f=fixture(t,{chatGPTStatus:async()=>{if(fail)throw new Error('Temporary connection failure');return{connected:false,email:null,state:'error',error:'Runtime is reconnecting'};}});
  f.push(connected);await f.connection.refresh();assert.equal(f.connection.state.connected,true);assert.match(f.connection.state.error,/Temporary/);
  fail=false;await f.connection.refresh();assert.equal(f.connection.state.connected,true);assert.equal(f.connection.state.email,'fictional@example.invalid');
  f.push({available:true,connected:false,email:null,plan:null,state:'signed_out',error:null});assert.equal(f.connection.state.connected,false);assert.equal(f.connection.state.email,null);
});

test('cancel login uses the dedicated auth action and dispose removes live and focus listeners',async t=>{
  let cancels=0;
  const f=fixture(t,{chatGPTCancelLogin:async()=>{cancels++;return{available:true,connected:false,signingIn:false,state:'signed_out'};}});
  f.push({available:true,connected:false,signingIn:true});await f.connection.cancelLogin();assert.equal(cancels,1);assert.equal(f.connection.state.signingIn,false);
  const checks=f.statusCalls;f.connection.dispose();f.dom.window.dispatchEvent(new f.dom.window.Event('focus'));assert.equal(f.statusCalls,checks);assert.equal(f.unsubscribed,1);
});

test('the last view unsubscribe clears sign-in polling and document-only tests can dispose safely',t=>{
  const f=fixture(t), scheduled=new Map(), oldSet=globalThis.setTimeout, oldClear=globalThis.clearTimeout;let next=0;
  globalThis.setTimeout=(callback,delay)=>{const id=++next;scheduled.set(id,{callback,delay});return id;};globalThis.clearTimeout=id=>scheduled.delete(id);
  try {
    const off=f.connection.subscribe(()=>{});f.push({signingIn:true,connected:false});assert.equal(scheduled.size,1);
    off();assert.equal(scheduled.size,0);f.push({signingIn:true});assert.equal(scheduled.size,0);
    const again=f.connection.subscribe(()=>{});assert.equal(scheduled.size,1);again();assert.equal(scheduled.size,0);
    globalThis.window=undefined;f.connection.dispose();assert.equal(f.unsubscribed,1);
  } finally {globalThis.setTimeout=oldSet;globalThis.clearTimeout=oldClear;globalThis.window=f.dom.window;}
});
