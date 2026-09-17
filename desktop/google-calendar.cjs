const { createServer } = require('node:http');
const { randomBytes, createHash, timingSafeEqual } = require('node:crypto');
const { readFileSync, writeFileSync, renameSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');
const SCOPE = 'https://www.googleapis.com/auth/calendar.app.created';
const API = 'https://www.googleapis.com/calendar/v3';
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !value.startsWith('0000') && Number.isFinite(Date.parse(value)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0,10) === value;
function validateEvents(events) {
  if (!Array.isArray(events) || !events.length || events.length > 100) throw new Error('Select between 1 and 100 calendar entries.');
  const ids = new Set();
  return events.map(e => {
    if (!e || typeof e.id !== 'string' || !e.id.trim() || e.id.length > 300 || e.id.includes('\0') || typeof e.title !== 'string' || !e.title.trim() || e.title.length > 300 || !validDate(e.date) || e.date === '9999-12-31' || (e.details !== undefined && (typeof e.details !== 'string' || e.details.length > 6000))) throw new Error('A selected calendar entry is invalid.');
    if (ids.has(e.id)) throw new Error('Select each calendar entry once.');
    ids.add(e.id);
    return { id:e.id, title:e.title.trim(), date:e.date, details:e.details || '' };
  });
}
function createGoogleCalendar({ profileDir, safeStorage, openExternal, fetchImpl = fetch, timeoutMs = 300000 }) {
  const file = join(profileDir, 'google-calendar.enc');
  let pending = null, syncing = false, disconnecting = false, message = '', generation = 0;
  const requests = new Set();
  function read() {
    try { return JSON.parse(safeStorage.decryptString(readFileSync(file))); }
    catch(error) { if (error.code === 'ENOENT') return {}; throw new Error('Google connection storage could not be opened. Reconnect in Calendar.'); }
  }
  function write(value) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows credential protection is unavailable. Google sign-in was not saved.');
    mkdirSync(profileDir,{recursive:true});
    const tmp = `${file}.tmp`; writeFileSync(tmp, safeStorage.encryptString(JSON.stringify(value)), { mode:0o600 }); renameSync(tmp,file);
  }
  function status() {
    const state = read();
    return { available:true, configured:Boolean(state.client?.id), connected:Boolean(state.tokens?.refresh_token || state.tokens?.access_token), pending:Boolean(pending), message };
  }
  function configure(value) {
    if (!value || typeof value.client_id !== 'string' || !/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(value.client_id) || typeof value.client_secret !== 'string' || value.client_secret.length > 300 || !value.client_secret) throw new Error('Choose the JSON file for a Google Desktop app OAuth client.');
    if (pending || syncing || disconnecting) throw new Error('Finish the current Google connection first.');
    if (read().tokens) throw new Error('Disconnect Google before changing the app connection settings.');
    write({ client:{id:value.client_id,secret:value.client_secret} }); message = 'Google client imported. You can now connect your account.'; return status();
  }
  async function request(url, options = {}) {
    const controller = new AbortController(); requests.add(controller);
    try {
      const response = await fetchImpl(url, { ...options, signal:AbortSignal.any([controller.signal,AbortSignal.timeout(30000)]) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { const error = new Error(response.status === 401 ? 'Google sign-in expired. Disconnect and connect again.' : `Google Calendar could not complete the request (${response.status}).`); error.status = response.status; throw error; }
      return data;
    } finally { requests.delete(controller); }
  }
  async function connect() {
    if (pending) return status();
    if (syncing || disconnecting) throw new Error('Wait for the current Google operation to finish.');
    const state = read(); if (!state.client) throw new Error('Import a Google Desktop OAuth client first.');
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows credential protection is unavailable.');
    const nonce = randomBytes(32).toString('hex'), verifier = randomBytes(48).toString('base64url'), challenge = createHash('sha256').update(verifier).digest('base64url');
    const turn = generation, operation = { listener:null, timer:null, exchanging:false };
    pending = operation;
    const listener = createServer(async (req,res) => {
      res.setHeader('content-type','text/plain; charset=utf-8'); res.setHeader('cache-control','no-store'); res.setHeader('content-security-policy',"default-src 'none'");
      const expectedHost = `127.0.0.1:${listener.address()?.port}`;
      if (req.method !== 'GET' || req.headers.host !== expectedHost) { res.writeHead(400); res.end('Invalid callback.'); return; }
      const url = new URL(req.url,`http://${expectedHost}`), supplied = url.searchParams.get('state') || '';
      if (url.origin !== `http://${expectedHost}` || url.pathname !== '/oauth/callback' || !/^[a-f0-9]{64}$/.test(supplied) || !timingSafeEqual(Buffer.from(supplied),Buffer.from(nonce))) { res.writeHead(400); res.end('Invalid sign-in state. Return to Case Forge.'); return; }
      if (pending !== operation || operation.exchanging) { res.writeHead(409); res.end('This sign-in has already been handled.'); return; }
      operation.exchanging = true;
      try {
        if (url.searchParams.has('error')) throw new Error('Google sign-in was cancelled.');
        const code = url.searchParams.get('code'); if (!code || code.length > 8192) throw new Error('Google did not return a sign-in code.');
        const tokens = await request('https://oauth2.googleapis.com/token', { method:'POST', headers:{'content-type':'application/x-www-form-urlencoded'}, body:new URLSearchParams({code,client_id:state.client.id,client_secret:state.client.secret,redirect_uri:redirect,grant_type:'authorization_code',code_verifier:verifier}).toString() });
        if (turn !== generation) throw new Error('The workspace was locked. Connect again.');
        if (typeof tokens.access_token !== 'string' || !tokens.access_token || typeof tokens.refresh_token !== 'string' || !tokens.refresh_token || (tokens.scope && (typeof tokens.scope !== 'string' || !tokens.scope.split(' ').includes(SCOPE)))) throw new Error('Google did not grant the calendar connection. Try connecting again.');
        write({client:state.client,tokens:{access_token:tokens.access_token,refresh_token:tokens.refresh_token,expiresAt:Date.now()+(Number(tokens.expires_in)||3600)*1000}});
        message = 'Google Calendar connected.'; res.end('Connected. You can close this tab and return to Case Forge.');
      } catch(error) { if (pending === operation && turn === generation) message = error.message; if (!res.destroyed) { res.writeHead(400); res.end(error.message); } }
      finally { if (res.writableFinished || res.destroyed) stopPending(operation); else res.once('finish',()=>stopPending(operation)); }
    });
    operation.listener = listener;
    try { await new Promise((resolve,reject) => {
      const failed = error => { operation.cancelListen = null; reject(error); };
      operation.cancelListen = () => { listener.removeListener('error',failed); operation.cancelListen = null; reject(new Error('The workspace was locked.')); };
      listener.once('error',failed);
      listener.listen(0,'127.0.0.1',()=>{ listener.removeListener('error',failed); operation.cancelListen = null; resolve(); });
    }); }
    catch (error) { stopPending(operation); throw error; }
    if (turn !== generation || pending !== operation) { stopPending(operation); throw new Error('The workspace was locked.'); }
    const redirect = `http://127.0.0.1:${listener.address().port}/oauth/callback`;
    const timer = setTimeout(() => { if (pending === operation) { message = 'Google sign-in timed out. Try again.'; close(); } },timeoutMs); timer.unref?.();
    operation.timer = timer;
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({client_id:state.client.id,redirect_uri:redirect,response_type:'code',scope:SCOPE,state:nonce,code_challenge:challenge,code_challenge_method:'S256',access_type:'offline',prompt:'consent'}).toString();
    try { await openExternal(url.href); if (pending === operation) message = 'Finish signing in in your browser.'; return status(); }
    catch { stopPending(operation); throw new Error('Could not open Google sign-in in your browser.'); }
  }
  async function accessToken(turn) {
    const state = read(); if (!state.tokens) throw new Error('Connect Google Calendar first.');
    if (state.tokens.expiresAt > Date.now()+60000) return state.tokens.access_token;
    const fresh = await request('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:state.client.id,client_secret:state.client.secret,grant_type:'refresh_token',refresh_token:state.tokens.refresh_token}).toString()});
    if (turn !== generation) throw new Error('The workspace was locked.');
    if (typeof fresh.access_token !== 'string' || !fresh.access_token) throw new Error('Google sign-in expired. Connect again.');
    state.tokens = {...state.tokens,access_token:fresh.access_token,expiresAt:Date.now()+(Number(fresh.expires_in)||3600)*1000}; write(state); return fresh.access_token;
  }
  async function sync({ caseKey, events }) {
    events = validateEvents(events);
    if (typeof caseKey !== 'string' || !/^[a-f0-9]{64}$/.test(caseKey)) throw new Error('The active case changed. Reopen Calendar.');
    if (syncing) throw new Error('Calendar sync is already running.');
    if (pending || disconnecting) throw new Error('Finish the Google connection before syncing.');
    syncing = true; const turn = generation; const synced = [], failed = [];
    try {
      const token = await accessToken(turn); if (turn !== generation) throw new Error('The workspace was locked.');
      const headers = {authorization:`Bearer ${token}`,'content-type':'application/json'};
      const state = read(); let calendarId = state.calendarId;
      if (!calendarId) {
        const created = await request(`${API}/calendars`,{method:'POST',headers,body:JSON.stringify({summary:'Case Forge',description:'Entries you choose to sync from Case Forge.'})});
        if (turn !== generation) throw new Error('The workspace was locked.');
        calendarId = created.id; if (typeof calendarId !== 'string') throw new Error('Google did not create the Case Forge calendar.');
        write({...read(),calendarId});
      }
      for (const event of events) {
        if (turn !== generation) throw new Error('The workspace was locked.');
        const id = createHash('sha256').update(`${caseKey}:${event.id}`).digest('hex');
        const end = new Date(`${event.date}T00:00:00Z`); end.setUTCDate(end.getUTCDate()+1);
        const body = {id,summary:event.title,description:event.details,start:{date:event.date},end:{date:end.toISOString().slice(0,10)},visibility:'private'};
        const endpoint = `${API}/calendars/${encodeURIComponent(calendarId)}/events`;
        try {
          try { await request(endpoint,{method:'POST',headers,body:JSON.stringify(body)}); }
          catch(error) { if (turn !== generation) throw new Error('The workspace was locked.'); if (error.status !== 409) throw error; const {id:ignored,...patch} = body; await request(`${endpoint}/${id}`,{method:'PATCH',headers,body:JSON.stringify(patch)}); }
          if (turn !== generation) throw new Error('The workspace was locked.');
          synced.push(event.id);
        } catch(error) { if (turn !== generation) throw new Error('The workspace was locked.'); failed.push({id:event.id,error:error.message}); }
      }
      message = `${synced.length} entr${synced.length === 1 ? 'y' : 'ies'} synced${failed.length ? `; ${failed.length} could not sync` : ''}.`;
      return {...status(),synced,failed};
    } finally { syncing = false; }
  }
  async function disconnect() {
    if (disconnecting) throw new Error('Google disconnect is already running.');
    disconnecting = true;
    try {
    close(); const state = read();
    const token = state.tokens?.refresh_token || state.tokens?.access_token;
    write(state.client ? {client:state.client} : {});
    message = 'Disconnected on this computer. Previously synced events stay in Google Calendar.';
    if (token) {
      try { const response = await fetchImpl('https://oauth2.googleapis.com/revoke',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token}).toString(),signal:AbortSignal.timeout(10000)}); if (!response.ok) throw new Error('Revocation failed.'); }
      catch { message += ' Remove Case Forge access in your Google Account to revoke the remote connection.'; }
    }
    return status();
    } finally { disconnecting = false; }
  }
  function stopPending(operation) {
    if (!operation) return;
    clearTimeout(operation.timer); operation.cancelListen?.(); operation.listener?.close(()=>{}); operation.listener?.closeAllConnections?.();
    if (pending === operation) pending = null;
  }
  function close() { generation++; for (const request of requests) request.abort(new Error('The workspace was locked or the connection was cancelled.')); stopPending(pending); }
  return {status,configure,connect,sync,disconnect,close};
}
module.exports = { createGoogleCalendar, validateEvents, SCOPE };
