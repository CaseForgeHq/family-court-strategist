import { icon } from './icons.js';
import { getChatGPTConnection, chatGPTBrand } from './chatgpt-connection.js';
const loadChat = () => import('./vendor/deep-chat/2.5.1/deepChat.bundle.js');
export function safeChatLink(value) {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
}
export function createAssistant({ desktop, loadComponent = loadChat }) {
  const host = document.getElementById('panel-ai'), connection = getChatGPTConnection(desktop);
  let ready = false, busy = false, chat, unsubscribe, previousConnected = false, generation = 0;
  function notice(text) { const node = host.querySelector('.ai-status'); if (node) node.textContent = text || ''; }
  function paint(account) {
    if (!ready) return;
    host.dataset.connected = String(Boolean(account.connected));
    host.querySelector('#chat-account').textContent = account.connected ? account.email || 'Your ChatGPT account' : 'Your ChatGPT account';
    host.querySelector('#chat-plan').textContent = account.connected ? `${account.plan || 'Subscription'} · Connected` : 'Use your subscription through Codex';
    const login = host.querySelector('#chat-login');
    login.classList.toggle('chatgpt-signin', !account.connected);
    if (account.connected) login.textContent = 'Sign out'; else login.innerHTML = chatGPTBrand;
    login.disabled = busy || account.changing || account.checking || account.signingIn || !account.available;
    const cancel = host.querySelector('#chat-cancel-login');
    cancel.hidden = !account.signingIn; cancel.disabled = account.changing || !desktop?.chatGPTCancelLogin;
    host.querySelector('#chat-refresh').disabled = account.changing || !desktop?.chatGPTStatus;
    host.querySelector('#chat-new').disabled = busy || !account.connected || !desktop?.chatGPTNewConversation;
    chat?.disableSubmitButton?.(!account.connected || Boolean(account.changing));
    if (previousConnected && !account.connected) { chat?.clearMessages?.(true); notice('Signed out. This conversation has been cleared.'); }
    previousConnected = Boolean(account.connected);
    if (account.error) notice(account.error);
    else if (account.signingIn) notice('Finish signing in in your browser. This panel updates automatically.');
    else if (account.checking) notice('Checking your ChatGPT connection…');
    else if (!account.available) notice('ChatGPT sign-in is available in the desktop app.');
    else if (!busy) notice(account.connected ? 'Connected. You can start a conversation.' : 'Sign in to start a conversation.');
  }
  async function send(body, signals) {
    const text = body.messages?.at(-1)?.text?.trim();
    if (busy || !text || !connection.state.connected) { await signals.onResponse({ error: 'Sign in with ChatGPT before sending a message.' }); signals.onClose(); return; }
    const requestId = globalThis.crypto?.randomUUID?.() || `chat-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    busy = true; paint(connection.state); notice('Connecting…');
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
      notice(stopped ? 'Reply stopped.' : 'Reply complete. Check important details against your sources.');
      host.querySelector('#chat-announcement').textContent = stopped ? 'Reply stopped.' : `ChatGPT replied: ${String(result.text || '').slice(0, 4000)}`;
    } catch (error) { if (!connection.state.connected) stopped = true; await deltas; if (!stopped) await signals.onResponse({ error: error.message || 'Could not get a reply. Please try again.' }); notice(stopped ? 'Reply stopped.' : error.message); }
    finally { off?.(); signals.onClose(); busy = false; host.querySelector('#chat-login').disabled = Boolean(connection.state.changing || connection.state.signingIn || !connection.state.available); host.querySelector('#chat-new').disabled = !connection.state.connected || !desktop?.chatGPTNewConversation; chat?.disableSubmitButton?.(!connection.state.connected || Boolean(connection.state.changing)); chat?.focusInput?.(); }
  }
  async function mount() {
    if (ready) { void connection.refresh(); return; }
    ready = true; const version = ++generation;
    host.innerHTML = `<section class="ai-connection" aria-label="ChatGPT connection"><div class="ai-account-heading"><span class="ai-service-mark">${icon('ai')}</span><div><strong>ChatGPT</strong><small id="chat-plan"></small></div><button type="button" class="ai-icon-button" id="chat-refresh" aria-label="Refresh ChatGPT connection" title="Refresh connection">${icon('reset')}</button></div><p id="chat-account"></p><div class="ai-auth-actions"><button class="btn chatgpt-signin" id="chat-login" type="button">${chatGPTBrand}</button><button class="btn small" id="chat-cancel-login" type="button" hidden>Cancel sign-in</button></div></section><div class="ai-chat-toolbar"><p class="ai-status" role="status" aria-live="polite"></p><button type="button" class="ai-icon-button" id="chat-new" aria-label="New conversation" title="New conversation">${icon('plus')}</button></div><div class="ai-chat-surface" aria-label="AI conversation"></div><div id="chat-announcement" class="sr-only" role="log" aria-live="polite" aria-relevant="text additions"></div><p class="ai-chat-note">Only messages you send here go to ChatGPT. Case files are not attached. Check important answers against your sources.</p>`;
    unsubscribe = connection.subscribe(paint);
    host.querySelector('#chat-login').addEventListener('click', () => void (connection.state.connected ? connection.logout() : connection.login()));
    host.querySelector('#chat-cancel-login').addEventListener('click', () => void connection.cancelLogin());
    host.querySelector('#chat-refresh').addEventListener('click', () => void connection.refresh());
    host.querySelector('#chat-new').addEventListener('click', async () => { if (busy) return; try { const result = await desktop.chatGPTNewConversation(); if (result?.error) throw new Error(result.error); chat?.clearMessages?.(true); notice('New conversation.'); chat?.focusInput?.(); } catch (error) { notice(error.message); } });
    void connection.refresh();
    try {
      await loadComponent(); if (version !== generation) return;
      chat = document.createElement('deep-chat');
      chat.setAttribute('aria-label', 'ChatGPT conversation and message composer');
      chat.chatStyle = { fontFamily: 'inherit', width: '100%', height: '100%', border: 'none', backgroundColor: 'transparent', color: 'var(--ink)', borderRadius: '0' };
      chat.messageStyles = { default: { shared: { bubble: { fontSize: '13px', lineHeight: '1.65', maxWidth: '91%', borderRadius: '12px', padding: '10px 13px' } }, user: { bubble: { backgroundColor: 'var(--ai-user-bg)', color: 'var(--ink)' } }, ai: { bubble: { backgroundColor: 'var(--ai-reply-bg)', color: 'var(--ink)' } } } };
      chat.textInput = { characterLimit: 12000, placeholder: { text: 'Message ChatGPT…' }, styles: { container: { backgroundColor: 'var(--ai-input-bg)', border: '1px solid var(--line-2)', borderRadius: '12px', margin: '10px 0 0', minHeight: '48px', boxShadow: 'none' }, text: { color: 'var(--ink)', fontSize: '13px', padding: '13px 45px 13px 13px' }, focus: { border: '1px solid var(--action)' } } };
      chat.submitButtonStyles = { submit: { container: { default: { bottom: '10px', right: '10px', borderRadius: '8px', backgroundColor: 'var(--ai-send-bg)' } }, svg: { styles: { default: { fill: 'var(--ink)', width: '20px', height: '20px' } } } } };
      chat.introMessage = { text: '**A clearer next step**\n\nAsk a question, work through an idea, or get help putting your thoughts into words.' };
      chat.remarkable = { html: false, linkify: false, breaks: true };
      chat.requestBodyLimits = { maxMessages: 1, totalMessagesMaxCharLength: 12000 };
      chat.connect = { stream: true, handler: send };
      chat.auxiliaryStyle = `*{box-sizing:border-box} #messages{scrollbar-width:thin;padding:8px 0} a{color:var(--action);overflow-wrap:anywhere} pre{overflow:auto;max-width:100%;white-space:pre-wrap} img:not(.avatar){display:none} #text-input{max-height:130px} button:focus-visible,[tabindex]:focus-visible{outline:2px solid var(--action);outline-offset:2px} @media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;animation:none!important}}`;
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
