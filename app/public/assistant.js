import { icon } from './icons.js';
import { getChatGPTConnection, chatGPTBrand } from './chatgpt-connection.js';
const loadChat = () => import('./vendor/deep-chat/2.5.1/deepChat.bundle.js');
export function safeChatLink(value) {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
}
export function createAssistant({ desktop, loadComponent = loadChat }) {
  const host = document.getElementById('panel-ai'), connection = getChatGPTConnection(desktop);
  let ready = false, busy = false, resetting = false, chat, unsubscribe, previousConnected = false, generation = 0;
  function notice(text) { const node = host.querySelector('.ai-status'); if (node) { node.textContent = text || ''; node.hidden = !text; } }
  function labelSubmit() { chat?.shadowRoot?.querySelector('.input-button')?.setAttribute('aria-label', busy ? 'Stop reply' : 'Send message'); }
  function paint(account) {
    if (!ready) return;
    host.dataset.connected = String(Boolean(account.connected));
    host.querySelector('.ai-connection').hidden = Boolean(account.connected);
    host.querySelector('.ai-session-menu').hidden = !account.connected;
    host.querySelector('#chat-session-email').textContent = account.email || 'Your ChatGPT account';
    host.querySelector('#chat-session-plan').textContent = account.plan ? `${account.plan} · Connected` : 'Connected';
    host.querySelector('#chat-signout').disabled = busy || resetting || Boolean(account.changing);
    host.querySelector('#chat-account').textContent = account.connected ? account.email || 'Your ChatGPT account' : 'Your ChatGPT account';
    host.querySelector('#chat-plan').textContent = account.connected ? `${account.plan || 'Subscription'} · Connected` : 'Use your subscription through Codex';
    const login = host.querySelector('#chat-login');
    login.classList.toggle('chatgpt-signin', !account.connected);
    if (account.connected) login.textContent = 'Sign out'; else login.innerHTML = chatGPTBrand;
    login.disabled = busy || resetting || account.changing || account.checking || account.signingIn || !account.available;
    const cancel = host.querySelector('#chat-cancel-login');
    cancel.hidden = !account.signingIn; cancel.disabled = account.changing || !desktop?.chatGPTCancelLogin;
    host.querySelector('#chat-refresh').disabled = account.changing || !desktop?.chatGPTStatus;
    host.querySelector('#chat-new').disabled = busy || resetting || !account.connected || !desktop?.chatGPTNewConversation;
    chat?.disableSubmitButton?.(!account.connected || resetting || Boolean(account.changing));
    labelSubmit();
    if (previousConnected && !account.connected) { chat?.clearMessages?.(true); if(chat) delete chat.dataset.hasMessages; host.querySelector('.ai-session-menu').open = false; notice('Signed out. This conversation has been cleared.'); }
    previousConnected = Boolean(account.connected);
    if (account.error) notice(account.error);
    else if (account.signingIn) notice('Finish signing in in your browser. This panel updates automatically.');
    else if (account.checking) notice('Checking your ChatGPT connection…');
    else if (!account.available) notice('ChatGPT sign-in is available in the desktop app.');
    else if (!busy && !resetting) notice(account.connected ? '' : 'Sign in to start a conversation.');
  }
  async function send(body, signals) {
    const text = body.messages?.at(-1)?.text?.trim();
    if (resetting) { await signals.onResponse({ error: 'Wait for the new conversation to finish opening.' }); signals.onClose(); return; }
    if (busy || !text || !connection.state.connected) { await signals.onResponse({ error: 'Sign in with ChatGPT before sending a message.' }); signals.onClose(); return; }
    const requestId = globalThis.crypto?.randomUUID?.() || `chat-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    busy = true; paint(connection.state); notice('Connecting…');
    if (chat) chat.dataset.hasMessages = 'true';
    let stopped = false, receivedText = '', deltas = Promise.resolve();
    const receiveText = value => {
      if (stopped || !connection.state.connected || typeof value !== 'string') return;
      const overwrite = !value.startsWith(receivedText), delta = overwrite ? value : value.slice(receivedText.length);
      receivedText = value;
      // App-server can replace commentary with the authoritative final answer.
      // Deep Chat's documented overwrite response replaces the current bubble.
      if (delta || overwrite) deltas = deltas.then(() => { if (!stopped && connection.state.connected) return signals.onResponse({ text: delta, ...(overwrite ? { overwrite:true } : {}) }); });
    };
    const off = desktop?.onChatGPTProgress?.(event => {
      if (event.requestId !== requestId) return;
      if (event.phase === 'delta' || event.phase === 'completed') receiveText(event.text);
      if (event.phase === 'replying') notice('ChatGPT is replying…');
    });
    signals.stopClicked.listener = async () => { stopped = true; notice('Stopping…'); try { await desktop.chatGPTCancel(); } catch (error) { notice(error.message); } };
    signals.onOpen();
    try {
      const result = await desktop.chatGPTChat({ text: text.slice(0, 12000), requestId });
      if (!connection.state.connected) stopped = true;
      if (!result.error && !stopped) receiveText(result.text || 'No reply returned.');
      await deltas;
      if (result.error) throw new Error(result.error);
      notice(stopped ? 'Reply stopped.' : 'Reply complete.');
      host.querySelector('#chat-announcement').textContent = stopped ? 'Reply stopped.' : `ChatGPT replied: ${String(result.text || '').slice(0, 4000)}`;
    } catch (error) { if (!connection.state.connected) stopped = true; await deltas; if (!stopped) await signals.onResponse({ error: error.message || 'Could not get a reply. Please try again.' }); notice(stopped ? 'Reply stopped.' : error.message); }
    finally { off?.(); signals.onClose(); busy = false; host.querySelector('#chat-login').disabled = Boolean(connection.state.changing || connection.state.signingIn || !connection.state.available); host.querySelector('#chat-signout').disabled = Boolean(connection.state.changing); host.querySelector('#chat-new').disabled = !connection.state.connected || !desktop?.chatGPTNewConversation; chat?.disableSubmitButton?.(!connection.state.connected || Boolean(connection.state.changing)); labelSubmit(); chat?.focusInput?.(); }
  }
  async function mount() {
    if (ready) { void connection.refresh(); return; }
    ready = true; const version = ++generation;
    host.innerHTML = `<section class="ai-connection" aria-label="ChatGPT connection"><div class="ai-account-heading"><span class="ai-service-mark">${icon('ai')}</span><div><strong>ChatGPT</strong><small id="chat-plan"></small></div><button type="button" class="ai-icon-button" id="chat-refresh" aria-label="Refresh ChatGPT connection" title="Refresh connection">${icon('reset')}</button></div><p id="chat-account"></p><div class="ai-auth-actions"><button class="btn chatgpt-signin" id="chat-login" type="button">${chatGPTBrand}</button><button class="btn small" id="chat-cancel-login" type="button" hidden>Cancel sign-in</button></div></section><div class="ai-chat-toolbar"><span class="ai-session-label">ChatGPT</span><div class="ai-toolbar-actions"><details class="ai-session-menu" hidden><summary class="ai-icon-button" aria-label="ChatGPT account" title="ChatGPT account">${icon('person')}</summary><div class="ai-session-popover"><strong id="chat-session-email"></strong><small id="chat-session-plan"></small><button class="btn small" id="chat-signout" type="button">Sign out</button></div></details><button type="button" class="ai-icon-button" id="chat-new" aria-label="New conversation" title="New conversation">${icon('plus')}</button></div></div><p class="ai-status" role="status" aria-live="polite" hidden></p><div class="ai-chat-surface" aria-label="AI conversation"></div><div id="chat-announcement" class="sr-only" role="log" aria-live="polite" aria-relevant="text additions"></div>`;
    unsubscribe = connection.subscribe(paint);
    host.querySelector('#chat-login').addEventListener('click', () => void (connection.state.connected ? connection.logout() : connection.login()));
    host.querySelector('#chat-signout').addEventListener('click', () => void connection.logout());
    host.querySelector('#chat-cancel-login').addEventListener('click', () => void connection.cancelLogin());
    host.querySelector('#chat-refresh').addEventListener('click', () => void connection.refresh());
    host.querySelector('#chat-new').addEventListener('click', async () => {
      if (busy || resetting || !connection.state.connected) return;
      resetting = true; paint(connection.state); notice('Starting a new conversation…');
      let message;
      try {
        const result = await desktop.chatGPTNewConversation();
        if (result?.error) throw new Error(result.error);
        chat?.clearMessages?.(true); if (chat) delete chat.dataset.hasMessages;
        message = 'New conversation.';
      } catch (error) { message = error.message; }
      finally { resetting = false; paint(connection.state); notice(message); chat?.focusInput?.(); }
    });
    void connection.refresh();
    try {
      await loadComponent(); if (version !== generation) return;
      chat = document.createElement('deep-chat');
      chat.setAttribute('aria-label', 'ChatGPT conversation and message composer');
      chat.chatStyle = { fontFamily: 'inherit', width: '100%', height: '100%', border: 'none', backgroundColor: 'transparent', color: 'var(--ink)', borderRadius: '0' };
      chat.messageStyles = { default: { shared: { bubble: { fontSize: '13px', lineHeight: '1.65', borderRadius: '11px', padding: '10px 12px' } }, user: { bubble: { maxWidth: '82%', backgroundColor: 'var(--ai-user-bg)', color: 'var(--ink)' } }, ai: { bubble: { width: '100%', maxWidth: '100%', backgroundColor: 'var(--ai-reply-bg)', color: 'var(--ink)' } } }, loading: { message: { html:'<div class="ai-typing" role="status" aria-label="ChatGPT is thinking"><span></span><span></span><span></span><small>Thinking</small></div>',styles:{bubble:{backgroundColor:'transparent',padding:'8px 2px',width:'100%'}} } } };
      chat.inputAreaStyle = { padding:'0',margin:'0',width:'100%' };
      chat.textInput = { characterLimit: 12000, placeholder: { text: 'Message ChatGPT…' }, styles: { container: { width:'100%',backgroundColor: 'var(--ai-input-bg)', border: '1px solid var(--line-2)', borderRadius: '11px', margin: '8px 0 0', minHeight: '48px', boxShadow: 'none' }, text: { color: 'var(--ink)', fontSize: '14px', lineHeight:'1.5',padding: '13px 49px 13px 13px' }, focus: { border: '1px solid var(--action)' } } };
      const sendIcon='<svg id="chat-send-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6"/></svg>';
      const stopIcon='<svg id="chat-stop-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="1.5"/></svg>';
      const button = content => ({container:{default:{width:'32px',height:'32px',borderRadius:'9px',backgroundColor:'var(--ai-button-bg)',color:'var(--ai-button-ink)',display:'grid',placeItems:'center',padding:'0',opacity:'1'},hover:{backgroundColor:'var(--action)'}},svg:{content,styles:{default:{width:'21px',height:'21px',margin:'0',color:'inherit'}}}});
      chat.submitButtonStyles = { submit:button(sendIcon),stop:button(stopIcon),loading:button(stopIcon),disabled:{...button(sendIcon),container:{default:{...button(sendIcon).container.default,opacity:'.4'}}} };
      chat.introMessage = { text: '**A clearer next step**\n\nAsk a question, work through an idea, or get help putting your thoughts into words.' };
      chat.remarkable = { html: false, linkify: false, breaks: true };
      chat.requestBodyLimits = { maxMessages: 1, totalMessagesMaxCharLength: 12000 };
      chat.connect = { stream: true, handler: send };
      chat.auxiliaryStyle = `*{box-sizing:border-box} #chat-view{grid-template-rows:minmax(0,1fr) auto} #messages{min-height:0;padding:8px 0;scrollbar-gutter:stable;scrollbar-width:auto;scrollbar-color:auto;overscroll-behavior:contain} #messages::-webkit-scrollbar,#text-input::-webkit-scrollbar{width:5px} #messages::-webkit-scrollbar-track,#text-input::-webkit-scrollbar-track{background:transparent} #messages::-webkit-scrollbar-thumb,#text-input::-webkit-scrollbar-thumb{border-radius:8px;background:var(--ai-scroll-thumb)} #messages::-webkit-scrollbar-button,#text-input::-webkit-scrollbar-button{display:none;width:0;height:0} .inner-message-container{width:100%;margin-inline:0} .inside-end{inset-inline-end:8px;inset-block-end:8px} #input{padding:0;margin:0;width:100%;align-self:end;height:fit-content} #text-input{max-height:130px;scrollbar-width:auto;scrollbar-color:auto} .ai-typing{display:flex;align-items:center;gap:4px;color:var(--ink-2);min-height:20px}.ai-typing span{width:4px;height:4px;border-radius:50%;background:currentColor;animation:chat-thinking 1.3s ease-in-out infinite}.ai-typing span:nth-child(2){animation-delay:.15s}.ai-typing span:nth-child(3){animation-delay:.3s}.ai-typing small{font-size:11px;margin-left:6px}@keyframes chat-thinking{0%,70%,100%{opacity:.35;transform:translateY(0)}35%{opacity:1;transform:translateY(-2px)}} :host([data-has-messages="true"]) .deep-chat-intro{display:none} a{color:var(--action);overflow-wrap:anywhere} pre{overflow:auto;max-width:100%;white-space:pre-wrap} img:not(.avatar){display:none} button:focus-visible,[tabindex]:focus-visible{outline:2px solid var(--action);outline-offset:2px}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;animation:none!important}}`;
      chat.onComponentRender = element => {
        const root = element.shadowRoot;
        root?.addEventListener('click', event => {
          const link = event.composedPath().find(node => node?.tagName === 'A');
          if (!link) return;
          event.preventDefault(); event.stopPropagation();
          const url = safeChatLink(link.getAttribute('href'));
          if (url && desktop?.chatGPTOpenLink) void desktop.chatGPTOpenLink(url);
          else notice(url ? 'Copy this link to open it in your browser.' : 'This link cannot be opened.');
        }, true);
        root?.querySelector('[contenteditable]')?.setAttribute('aria-label', 'Message ChatGPT');
        paint(connection.state);
      };
      host.querySelector('.ai-chat-surface').append(chat);
      paint(connection.state);
    } catch { notice('The chat interface could not load. Reopen the app to try again.'); }
  }
  const selected = event => { if (event.detail.name === 'ai') void mount(); };
  window.addEventListener('caseforge:panel-selected', selected);
  return { mount, destroy() { generation++; unsubscribe?.(); window.removeEventListener('caseforge:panel-selected', selected); ready = false; } };
}
