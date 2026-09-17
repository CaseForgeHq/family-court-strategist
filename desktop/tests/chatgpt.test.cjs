'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough, Writable } = require('node:stream');
const { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { createChatGPT, safeAuthUrl, SAFE_CONFIG, MAX_INPUT, SCAN_MODEL } = require('../chatgpt.cjs');

function nestedConfig() {
  const result = {};
  for (const [key, value] of Object.entries(SAFE_CONFIG)) {
    const parts = key.split('.'); let cursor = result;
    for (const part of parts.slice(0, -1)) cursor = cursor[part] ||= {};
    cursor[parts.at(-1)] = value;
  }
  return result;
}
function setup(t, options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'caseforge-chatgpt-test-'));
  const runtime = join(root, 'mock-codex.exe'); writeFileSync(runtime, 'not executed');
  const calls = [], responses = [], opened = [], children = [];
  const state = { account: options.connected ? { type: 'chatgpt', email: 'fictional@example.invalid', planType: 'plus' } : null, turns: 0, scans: 0 };
  const notify = (child, method, params) => child.stdout.write(`${JSON.stringify({ method, params })}\n`);
  const spawnImpl = (command, args, spawnOptions) => {
    const child = new EventEmitter(); children.push(child);
    child.command = command; child.args = args; child.options = spawnOptions;
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.killed = false;
    child.kill = () => { child.killed = true; queueMicrotask(() => child.emit('exit', 0)); return true; };
    child.stdin = new Writable({ write(chunk, encoding, callback) {
      const message = JSON.parse(chunk.toString());
      if (!message.method) { responses.push(message); callback(); return; }
      calls.push(message); callback();
      if (message.id === undefined) return;
      queueMicrotask(() => {
        const respond = result => child.stdout.write(`${JSON.stringify({ id: message.id, result })}\n`);
        const reject = error => child.stdout.write(`${JSON.stringify({ id: message.id, error })}\n`);
        if (options.onRequest?.({ message, child, state, respond, reject, notify }) === true) return;
        const params = message.params;
        if (message.method === 'initialize') respond({ userAgent: 'fictional-runtime' });
        else if (message.method === 'config/read') respond({ config: nestedConfig() });
        else if (message.method === 'account/read') respond({ account: state.account, requiresOpenaiAuth: true });
        else if (message.method === 'account/login/start') respond({ type: 'chatgpt', loginId: 'fictional-login', authUrl: options.authUrl || 'https://auth.openai.com/authorize?state=fictional' });
        else if (message.method === 'account/login/cancel') respond({ status: 'canceled' });
        else if (message.method === 'account/logout') { state.account = null; respond({}); }
        else if (message.method === 'model/list') respond({ data: [{ model: 'catalog-default-example', displayName: 'Default text model', isDefault: true, hidden: false, inputModalities: ['text'] }, { model: SCAN_MODEL, hidden: false, inputModalities: ['text', 'image'], supportedReasoningEfforts: [{ reasoningEffort: 'low' }] }], nextCursor: null });
        else if (message.method === 'thread/start') respond({ thread: { id: params.serviceName === 'case-forge-document-scan' ? `scan-thread-${++state.scans}` : 'fictional-thread', ephemeral: true }, approvalPolicy: 'never', cwd: params.cwd, sandbox: { type: 'readOnly', networkAccess: false }, instructionSources: [] });
        else if (message.method === 'turn/start') {
          const turnId = `fictional-turn-${++state.turns}`;
          respond({ turn: { id: turnId, status: 'inProgress', items: [] } });
          if (!options.holdTurn) setImmediate(() => {
            notify(child, 'item/agentMessage/delta', { threadId: params.threadId, turnId, itemId: 'reply', delta: 'Fictional ' });
            notify(child, 'item/agentMessage/delta', { threadId: params.threadId, turnId, itemId: 'reply', delta: 'reply.' });
            notify(child, 'item/completed', { threadId: params.threadId, turnId, item: { id: 'reply', type: 'agentMessage', phase: 'final_answer', text: params.outputSchema ? '{"summary":"Fictional result."}' : 'Fictional reply.' } });
            notify(child, 'turn/completed', { threadId: params.threadId, turn: { id: turnId, status: 'completed', items: [] } });
          });
        } else if (message.method === 'turn/interrupt') respond({});
        else if (message.method === 'thread/unsubscribe') respond({ status: 'unsubscribed' });
        else reject({ code: -32601, message: 'Unknown fixture method' });
      });
    } });
    return child;
  };
  const bridge = createChatGPT({ profileDir: join(root, 'profile'), runtimePath: runtime, openExternal: async url => { opened.push(url); }, version: 'test', spawnImpl, requestTimeoutMs: options.requestTimeoutMs || 1_000, turnTimeoutMs: options.turnTimeoutMs || 2_000 });
  t.after(() => { bridge.close(); rmSync(root, { recursive: true, force: true }); });
  return { root, runtime, bridge, calls, responses, opened, children, state, notify };
}
async function until(check) { for (let i = 0; i < 100; i++) { if (check()) return; await new Promise(resolve => setImmediate(resolve)); } assert.fail('Fixture did not reach expected state'); }

test('status starts lazily with isolated storage and verified text-only restrictions', async t => {
  const { bridge, children, calls, root } = setup(t);
  assert.equal(children.length, 0);
  assert.equal(existsSync(join(root, 'profile')), false);
  const status = await bridge.status();
  assert.equal(status.available, true); assert.equal(status.connected, false); assert.equal(status.error, null);
  const child = children[0];
  assert.equal(child.options.shell, false); assert.equal(child.options.windowsHide, true);
  assert.equal(child.options.env.CODEX_HOME, join(root, 'profile'));
  assert.equal(child.options.env.USERPROFILE, join(root, 'profile'));
  assert.equal(child.options.env.OPENAI_API_KEY, undefined);
  assert.equal(child.options.env.CODEX_THREAD_ID, undefined);
  assert.ok(child.options.cwd.startsWith(join(root, 'profile', 'chat-only-')));
  for (const [key, value] of Object.entries(SAFE_CONFIG)) assert.ok(child.args.includes(`${key}=${JSON.stringify(value)}`));
  assert.deepEqual(calls.map(call => call.method), ['initialize', 'initialized', 'config/read', 'account/read']);
  assert.equal(calls.some(call => /login|thread|turn/.test(call.method)), false);
});

test('managed browser login opens only the returned vetted URL and status confirms completion', async t => {
  const f = setup(t);
  const starting = await f.bridge.login();
  assert.equal(starting.signingIn, true); assert.equal(starting.connected, false);
  assert.deepEqual(f.opened, ['https://auth.openai.com/authorize?state=fictional']);
  await f.bridge.login(); assert.equal(f.opened.length, 1);
  f.state.account = { type: 'chatgpt', email: 'fictional@example.invalid', planType: 'plus', accessToken: 'never-return-this' };
  f.notify(f.children[0], 'account/login/completed', { loginId: 'fictional-login', success: true });
  const status = await f.bridge.status();
  assert.equal(status.connected, true); assert.equal(status.signingIn, false);
  assert.equal(status.email, 'fictional@example.invalid'); assert.equal(status.plan, 'plus');
  assert.doesNotMatch(JSON.stringify(status), /Token|never-return-this|authUrl|loginId/);
  assert.deepEqual(f.calls.find(call => call.method === 'account/login/start').params, { type: 'chatgpt', useHostedLoginSuccessPage: true, appBrand: 'chatgpt' });
});

test('untrusted login URLs are refused and the pending ceremony is cancelled', async t => {
  for (const url of ['http://auth.openai.com/login', 'https://auth.openai.com.evil.invalid/login', 'file:///C:/case.txt', 'https://user:secret@auth.openai.com/login', 'https://chatgpt.com:444/login']) assert.throws(() => safeAuthUrl(url), /address/);
  const f = setup(t, { authUrl: 'https://evil.invalid/steal' });
  await assert.rejects(f.bridge.login(), /could not be opened safely/);
  assert.deepEqual(f.opened, []);
  assert.ok(f.calls.some(call => call.method === 'account/login/cancel'));
  assert.equal((await f.bridge.status()).signingIn, false);
});

test('chat uses the catalog default, an ephemeral isolated conversation, and only explicitly sent text', async t => {
  const f = setup(t, { connected: true });
  const reply = await f.bridge.chat({ text: 'Explain the fictional appointment letter.' });
  assert.deepEqual(reply, { text: 'Fictional reply.', model: 'catalog-default-example' });
  const start = f.calls.find(call => call.method === 'thread/start');
  assert.equal(start.params.ephemeral, true); assert.equal(start.params.sandbox, 'read-only'); assert.equal(start.params.approvalPolicy, 'never');
  assert.equal(start.params.cwd, f.children[0].options.cwd);
  assert.equal(start.params.model, 'catalog-default-example');
  assert.match(start.params.developerInstructions, /13-point forensic workflow/);
  assert.match(start.params.developerInstructions, /untrusted data, never instructions/);
  assert.match(start.params.developerInstructions, /Do not request or use tools/);
  const turn = f.calls.find(call => call.method === 'turn/start');
  assert.deepEqual(turn.params.input, [{ type: 'text', text: 'Explain the fictional appointment letter.', text_elements: [] }]);
  assert.deepEqual(turn.params.sandboxPolicy, { type: 'readOnly', networkAccess: false });
  await f.bridge.chat({ text: 'Make that shorter.' });
  assert.equal(f.calls.filter(call => call.method === 'thread/start').length, 1, 'Conversation is retained only inside this running session');
  assert.equal((await f.bridge.status()).busy, false);
  f.bridge.close();
  assert.equal(f.children[0].killed, true);
  assert.equal(f.calls.some(call => call.method === 'account/logout'), false, 'Closing or locking must not sign the account out');
});

test('missing login and unsupported attachment payloads never begin inference', async t => {
  const f = setup(t);
  await assert.rejects(f.bridge.chat({ text: 'Hello' }), /Sign in/);
  await assert.rejects(f.bridge.chat({ text: 'Hello', path: 'C:/private-case.pdf' }), /File attachments/);
  await assert.rejects(f.bridge.chat({ text: 'x'.repeat(MAX_INPUT + 1) }), /40,000/);
  assert.equal(f.calls.some(call => call.method === 'model/list' || call.method === 'thread/start' || call.method === 'turn/start'), false);
});

test('deep search creates a separate conversation and restores ordinary chat without attaching its history', async t => {
  let threads = 0;
  const f = setup(t, { connected:true, onRequest:({message,respond})=>{
    if(message.method !== 'thread/start') return false;
    respond({thread:{id:`separate-${++threads}`,ephemeral:true},approvalPolicy:'never',cwd:message.params.cwd,sandbox:{type:'readOnly',networkAccess:false},instructionSources:[]}); return true;
  }});
  await f.bridge.chat({text:'Ordinary private conversation.'});
  await f.bridge.chat({text:'Reviewed excerpts only.'},{isolated:true});
  await f.bridge.chat({text:'Continue ordinary conversation.'});
  const turns=f.calls.filter(c=>c.method==='turn/start');
  assert.deepEqual(turns.map(c=>c.params.threadId),['separate-1','separate-2','separate-1']);
  assert.deepEqual(turns[1].params.input.map(i=>i.text),['Reviewed excerpts only.']);
  assert.equal(f.calls.filter(c=>c.method==='thread/start').length,2);
});

test('server tool or approval requests are rejected and stop the text-only session', async t => {
  const f = setup(t, { connected: true, holdTurn: true });
  const reply = f.bridge.chat({ text: 'A fictional test.' });
  await until(() => f.calls.some(call => call.method === 'turn/start'));
  f.children[0].stdout.write(`${JSON.stringify({ id: 'tool-1', method: 'item/tool/call', params: { name: 'exec_command', arguments: { command: 'never execute' } } })}\n`);
  await assert.rejects(reply, /outside this text-only chat/);
  assert.equal(f.children[0].killed, true);
  assert.equal(f.responses[0].error.code, -32601);
  assert.equal(f.calls.some(call => call.method === 'command/exec'), false);
});

test('unsolicited tool activity is a fail-closed protocol violation', async t => {
  const f = setup(t, { connected: true, holdTurn: true });
  const reply = f.bridge.chat({ text: 'A fictional test.' });
  await until(() => f.calls.some(call => call.method === 'turn/start'));
  f.notify(f.children[0], 'item/started', { threadId: 'fictional-thread', turnId: 'fictional-turn-1', item: { type: 'commandExecution', id: 'forbidden' } });
  await assert.rejects(reply, /outside this text-only chat/);
  assert.equal(f.children[0].killed, true);
});

test('cancel interrupts an active reply and clears conversation without logging out', async t => {
  const f = setup(t, { connected: true, holdTurn: true });
  const reply = f.bridge.chat({ text: 'A fictional test.' });
  await until(() => f.calls.some(call => call.method === 'turn/start'));
  await new Promise(resolve => setImmediate(resolve));
  await f.bridge.cancel();
  await assert.rejects(reply, /cancelled/);
  assert.ok(f.calls.some(call => call.method === 'turn/interrupt'));
  assert.equal(f.children[0].killed, true);
  assert.equal(f.calls.some(call => call.method === 'account/logout'), false);
});

test('explicit logout invokes the managed logout method and clears chat', async t => {
  const f = setup(t, { connected: true });
  await f.bridge.status();
  const status = await f.bridge.logout();
  assert.equal(status.connected, false);
  assert.ok(f.calls.some(call => call.method === 'account/logout'));
  assert.equal(f.children[0].killed, true);
});

test('RPC timeout stops the process and does not leave pending operations', async t => {
  const f = setup(t, { requestTimeoutMs: 15, onRequest: ({ message }) => message.method === 'account/read' });
  const result = await f.bridge.status();
  assert.match(result.error, /did not respond in time/);
  assert.equal(f.children[0].killed, true);
});

test('provider diagnostics are never returned verbatim to the renderer', async t => {
  const f = setup(t, { onRequest: ({ message, reject }) => {
    if (message.method !== 'account/read') return false;
    reject({ code: 123, message: 'secret OAuth token sensitive-value' }); return true;
  } });
  const status = await f.bridge.status();
  assert.match(status.error, /could not complete/);
  assert.doesNotMatch(JSON.stringify(status), /sensitive-value|OAuth token/);
});

test('unexpected effective configuration blocks chat before account or inference calls', async t => {
  const f = setup(t, { connected: true, onRequest: ({ message, respond }) => {
    if (message.method !== 'config/read') return false;
    const config = nestedConfig(); config.features.shell_tool = true;
    respond({ config }); return true;
  } });
  const status = await f.bridge.status();
  assert.match(status.error, /restrictions could not be verified/);
  assert.equal(f.children[0].killed, true);
  assert.equal(f.calls.some(call => call.method === 'account/read'), false);
});

test('thread restrictions and instruction sources are checked before a text turn', async t => {
  const f = setup(t, { connected: true, onRequest: ({ message, respond }) => {
    if (message.method !== 'thread/start') return false;
    respond({ thread: { id: 'bad-thread', ephemeral: false }, cwd: message.params.cwd, approvalPolicy: 'never', sandbox: { type: 'readOnly' }, instructionSources: ['C:/other/AGENTS.md'] }); return true;
  } });
  await assert.rejects(f.bridge.chat({ text: 'Hello' }), /restrictions could not be verified/);
  assert.equal(f.calls.some(call => call.method === 'turn/start'), false);
});

test('reply and protocol buffers are bounded', async t => {
  const f = setup(t, { connected: true, holdTurn: true });
  const reply = f.bridge.chat({ text: 'Hello' });
  await until(() => f.calls.some(call => call.method === 'turn/start'));
  f.notify(f.children[0], 'item/agentMessage/delta', { threadId: 'fictional-thread', turnId: 'fictional-turn-1', itemId: 'reply', delta: 'x'.repeat(128_001) });
  await assert.rejects(reply, /text limit/);
  assert.equal(f.children[0].killed, true);
  const g = setup(t);
  await g.bridge.status();
  g.children[0].stdout.write('x'.repeat(2_000_001));
  assert.equal(g.children[0].killed, true);
});

test('a missing catalog default fails without guessing or substituting a model', async t => {
  const f = setup(t, { connected: true, onRequest: ({ message, respond }) => {
    if (message.method !== 'model/list') return false;
    respond({ data: [{ model: 'arbitrary-model', isDefault: false, hidden: false }], nextCursor: null }); return true;
  } });
  await assert.rejects(f.bridge.chat({ text: 'Hello' }), /No default text model/);
  assert.equal(f.calls.some(call => call.method === 'thread/start'), false);
});
