import { icon } from './icons.js';
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function createAssistant({ desktop }) {
  const host = document.getElementById('panel-ai');
  let ready = false, busy = false, polling = null, account = null;
  function notice(text) { host.querySelector('.ai-status').textContent = text || ''; }
  function message(role,text) {
    const row = document.createElement('div'); row.className = `ai-message ${role}`;
    const label = document.createElement('strong'); label.textContent = role === 'user' ? 'You' : 'ChatGPT';
    row.append(label,document.createTextNode(text)); host.querySelector('.ai-messages').append(row); row.scrollIntoView({block:'nearest'});
  }
  function paintStatus() {
    const status = host.querySelector('#chat-account');
    status.innerHTML = account?.connected ? `<strong>ChatGPT connected</strong><small>${esc(account.email || 'Your subscription')}${account.plan ? ` · ${esc(account.plan)}` : ''}</small>` : '<strong>Your ChatGPT account</strong><small>Use your own subscription through Codex.</small>';
    const login = host.querySelector('#chat-login');
    login.textContent = account?.connected ? 'Sign out' : account?.signingIn ? 'Waiting…' : 'Sign in with ChatGPT';
    login.disabled = busy || Boolean(account?.signingIn) || !desktop?.chatGPTLogin;
    host.querySelector('#chat-send').disabled = busy || !account?.connected;
    host.querySelector('#chat-stop').hidden = !busy;
    if(account?.error) notice(account.error);
  }
  async function status() {
    try { account = await desktop.chatGPTStatus(); if(account.error) notice(account.error); paintStatus(); if(!account.signingIn) { clearInterval(polling); polling = null; } }
    catch(error) { notice(error.message || 'Could not check your ChatGPT connection.'); }
  }
  function mount() {
    if(ready) { if(desktop?.chatGPTStatus) void status(); return; }
    ready = true;
    host.innerHTML = `<div class="ai-account"><p id="chat-account"></p><button class="btn small" id="chat-login" type="button">Sign in with ChatGPT</button></div><p class="ai-status" role="status" aria-live="polite"></p><div class="ai-messages" role="log" aria-label="AI conversation"><p class="ai-empty">A quiet place to ask a question.<br>Only messages you send here go to ChatGPT. Files and your journal are not attached.</p></div><form class="ai-compose"><label class="sr-only" for="chat-text">Message ChatGPT</label><textarea id="chat-text" placeholder="Ask about your next step…" maxlength="12000" required></textarea><div class="ai-compose-footer"><small>ChatGPT can make mistakes. Check answers against your sources.</small><button id="chat-stop" class="btn small" type="button" hidden>Stop</button><button id="chat-send" class="btn primary" type="submit" disabled>${icon('send')} Send</button></div></form>`;
    paintStatus();
    if(!desktop?.chatGPTStatus) { notice('ChatGPT sign-in is available in the desktop app.'); return; }
    void status();
    host.querySelector('#chat-login').addEventListener('click', async () => {
      try {
        host.querySelector('#chat-login').disabled = true;
        const signingOut = account?.connected;
        account = signingOut ? await desktop.chatGPTLogout() : await desktop.chatGPTLogin();
        if(account.error) throw new Error(account.error);
        if(signingOut) { host.querySelector('.ai-messages').innerHTML = '<p class="ai-empty">Signed out. This conversation has been cleared.</p>'; host.querySelector('#chat-text').value = ''; }
        notice(account.signingIn ? 'Finish signing in in your browser.' : 'Signed out.');
        paintStatus();
        if(account.signingIn && !polling) polling = setInterval(status,2000);
      } catch(error) { notice(error.message); host.querySelector('#chat-login').disabled = false; }
    });
    host.querySelector('#chat-stop').addEventListener('click', async () => { await desktop.chatGPTCancel(); notice('Stopped.'); });
    host.querySelector('form').addEventListener('submit', async event => {
      event.preventDefault(); const input = host.querySelector('#chat-text'), text = input.value.trim();
      if(busy || !text || !account?.connected) return;
      busy = true; paintStatus(); host.querySelector('.ai-empty')?.remove(); message('user',text); input.value = ''; notice('Thinking…');
      try { const result = await desktop.chatGPTChat({text}); if(result.error) throw new Error(result.error); message('assistant',result.text || 'No reply returned.'); notice(''); }
      catch(error) { notice(error.message || 'Could not get a reply. Your message is still shown above.'); }
      finally { busy = false; paintStatus(); input.focus(); }
    });
  }
  window.addEventListener('caseforge:panel-selected', event => { if(event.detail.name === 'ai') mount(); });
  return {mount};
}
