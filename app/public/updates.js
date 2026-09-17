import { icon } from './icons.js';

export function createUpdates({ desktop, format = 'popover' }) {
  let trigger = document.getElementById('open-updates');
  if (!trigger && format === 'notification' && desktop?.updateStatus) {
    trigger = document.createElement('button'); trigger.id = 'open-updates'; trigger.className = 'entry-updates-trigger';
    
    trigger.setAttribute('aria-label', 'Updates'); trigger.setAttribute('aria-expanded', 'false'); document.body.append(trigger);
  }
  if (!trigger || !desktop?.updateStatus) return;
  trigger.hidden = format === 'notification';
  trigger.innerHTML = `<span class="updates-icon-stack" aria-hidden="true"><span class="updates-shield">${icon('shield')}</span><span class="updates-download">${icon('download')}</span></span><span class="update-dot" aria-hidden="true" hidden>!</span>`;
  trigger.setAttribute('aria-controls', 'updates-popover'); trigger.setAttribute('aria-haspopup', 'dialog');
  const panel = document.createElement('section');
  panel.id = 'updates-popover'; panel.className = `updates-popover${format === 'notification' ? ' updates-notification' : ''}`; panel.hidden = true;
  panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Update message');
  panel.innerHTML = `<div class="updates-body"><section class="updates-message"><span class="updates-sigil" aria-hidden="true"></span><div class="updates-copy"><span class="updates-sender" hidden>Case Forge Admin Says</span><p></p></div><button class="btn primary" data-update-action hidden title="Download, install and reopen Case Forge">Download</button><button class="updates-close" aria-label="Close updates" title="Close">${icon('close')}</button></section><p class="updates-status" role="status" aria-live="polite" hidden></p><div class="updates-transfer" hidden><span class="updates-spinner" aria-hidden="true"></span><span class="updates-transfer-label" role="status" aria-live="polite"></span><progress max="100" aria-label="Update download progress"></progress></div></div>`;
  document.body.append(panel);
  const versionLabel = document.createElement('span'); versionLabel.className = 'updates-version';
  panel.querySelector('.updates-copy').insertBefore(versionLabel, panel.querySelector('.updates-copy p'));
  const history = document.createElement('div'); history.className = 'updates-history'; history.hidden = true;
  panel.querySelector('.updates-message').after(history);
  const $ = selector => panel.querySelector(selector);
  let state = { phase: 'idle' }, pinned = false, timer, busy = false, focusSuppressed = false, announced = '';
  function position() { const r = trigger.getBoundingClientRect(); panel.style.left = `${Math.max(12, Math.min(r.right - panel.offsetWidth, window.innerWidth - panel.offsetWidth - 12))}px`; panel.style.top = `${Math.min(r.bottom + 10, window.innerHeight - 180)}px`; panel.style.maxHeight = `${Math.max(160, window.innerHeight - r.bottom - 22)}px`; }
  function render() {
    const phase = state.phase;
    const notices = Array.isArray(state.notices) ? state.notices.filter(item => item && typeof item.message === 'string' && /^\d+\.\d+\.\d+$/.test(item.version)).map(item => ({ ...item })) : [];
    if (state.version && state.message && phase !== 'current' && !notices.some(item => item.version === state.version)) notices.push({ id: `v${state.version}`, version: state.version, message: state.message });
    notices.sort((a, b) => { const x = a.version.split('.').map(Number), y = b.version.split('.').map(Number); return y[0]-x[0] || y[1]-x[1] || y[2]-x[2]; });
    panel.setAttribute('aria-label', state.required ? 'Required update message' : 'Update message');
    $('.updates-status').textContent = state.error || '';
    $('.updates-status').hidden = !state.error;
    const transferring = ['downloading', 'verifying', 'preparing', 'restarting', 'installing'].includes(phase);
    $('.updates-transfer').hidden = !transferring;
    $('.updates-transfer-label').textContent = phase === 'preparing' ? 'Preparing update…' : phase === 'verifying' ? 'Verifying update…' : ['restarting', 'installing'].includes(phase) ? 'Restarting Case Forge…' : state.fullDownload ? 'Downloading the complete update…' : 'Downloading…';
    if (phase === 'downloading' && Number.isFinite(state.progress)) $('progress').value = state.progress;
    else $('progress').removeAttribute('value');
    trigger.classList.toggle('is-transferring', transferring);
    const hasRelease = notices.length > 0 || ['available', 'downloading', 'verifying', 'preparing', 'ready', 'restarting', 'installing'].includes(phase) || (phase === 'error' && Boolean(state.version));
    $('.updates-message p').textContent = notices[0]?.message || (phase === 'current' ? 'You are currently up to date' : hasRelease ? (state.message || 'A new update is ready.') : phase === 'error' ? 'Unable to check for updates' : phase === 'unavailable' ? 'Updates are available in the installed app' : 'Checking for updates…');
    versionLabel.hidden = !hasRelease || !notices[0]?.version;
    versionLabel.textContent = notices[0]?.version ? ` · v${notices[0].version}` : '';
    const historyKey = JSON.stringify(notices.slice(1));
    if (history.dataset.key !== historyKey) {
      history.dataset.key = historyKey; history.replaceChildren();
      for (const notice of notices.slice(1)) {
        const row = document.createElement('section'); row.className = 'updates-message updates-history-message'; row.dataset.releaseId = notice.id;
        row.innerHTML = '<span class="updates-sigil" aria-hidden="true">!</span><div class="updates-copy"><span class="updates-sender">Case Forge Admin Says</span><span class="updates-version"></span><p></p></div>';
        row.querySelector('.updates-version').textContent = ` · v${notice.version}`;
        row.querySelector('p').textContent = notice.message; history.append(row);
      }
    }
    history.hidden = notices.length < 2;
    $('.updates-sender').hidden = !hasRelease;
    $('.updates-sigil').textContent = hasRelease ? '!' : phase === 'current' ? '✓' : '·';
    panel.dataset.phase = phase;
    const action = $('[data-update-action]');
    action.hidden = !['available', 'downloading', 'verifying', 'preparing', 'ready', 'restarting', 'installing'].includes(phase) && !(phase === 'error' && state.version);
    action.textContent = phase === 'ready' ? 'Restart and install' : phase === 'downloading' ? (state.fullDownload ? 'Downloading…' : `${Math.round(state.progress || 0)}%`) : phase === 'preparing' ? 'Preparing…' : phase === 'verifying' ? 'Verifying…' : ['restarting', 'installing'].includes(phase) ? 'Restarting…' : 'Download';
    action.disabled = busy || ['downloading', 'verifying', 'preparing', 'restarting', 'installing'].includes(phase);
    if (transferring && notices[0]?.version && state.version !== notices[0].version) action.textContent = `Updating v${state.version}`;
    const available = hasRelease;
    trigger.hidden = format === 'notification' && !available;
    if (trigger.hidden) close();
    trigger.classList.toggle('has-update', available);
    panel.classList.toggle('has-update', available);
    trigger.querySelector('.update-dot').hidden = !available;
    trigger.setAttribute('aria-label', available ? `Updates — ${Math.max(1, notices.length)} available` : 'Updates');
    const notice = notices.map(item => item.id || item.version).join('|') || `${state.version}:${state.required}`;
    if (available && (state.version || notices.length) && notice !== announced) {
      trigger.classList.remove('update-arrival'); void trigger.offsetWidth; trigger.classList.add('update-arrival');
      announced = notice;
    }
    if (!panel.hidden) position();
  }
  function receive(value) {
    if (!value?.phase || (value.revision || 0) < (state.revision || 0)) return;
    state = value; render();
  }
  async function refresh() { try { receive(await desktop.updateStatus()); } catch { /* Keep the last known state during lock or shutdown. */ } }
  function open() { clearTimeout(timer); panel.hidden = false; trigger.setAttribute('aria-expanded', 'true'); position(); void refresh(); }
  function close(focus = false) { clearTimeout(timer); pinned = false; panel.hidden = true; trigger.setAttribute('aria-expanded', 'false'); if (focus) { focusSuppressed = true; trigger.focus(); focusSuppressed = false; } }
  function leave() { clearTimeout(timer); timer = setTimeout(() => { if (!pinned && !panel.contains(document.activeElement) && document.activeElement !== trigger) close(); }, 220); }
  trigger.addEventListener('pointerenter', open); trigger.addEventListener('pointerleave', leave);
  trigger.addEventListener('focus', () => { if (!focusSuppressed) open(); });
  trigger.addEventListener('click', () => { if (pinned) close(); else { pinned = true; open(); } });
  trigger.addEventListener('keydown', event => { if (event.key === 'ArrowDown') { event.preventDefault(); pinned = true; open(); $('.updates-close').focus(); } });
  panel.addEventListener('pointerenter', () => clearTimeout(timer)); panel.addEventListener('pointerleave', leave);
  panel.addEventListener('focusout', leave); trigger.addEventListener('blur', leave);
  $('.updates-close').addEventListener('click', () => close(true));
  document.addEventListener('keydown', event => { if (!panel.hidden && event.key === 'Escape') { event.preventDefault(); close(true); } });
  document.addEventListener('pointerdown', event => { if (!panel.hidden && !panel.contains(event.target) && !trigger.contains(event.target)) close(); });
  window.addEventListener('resize', () => { if (!panel.hidden) position(); });
  async function action(method) {
    if (busy) return; busy = true; pinned = true; render();
    try { const result = await desktop[method](); if (result.phase) receive(result); else if (result.error) state = { ...state, error: result.error }; }
    catch { state = { ...state, error: 'Could not complete this action. Please try again.' }; }
    finally { busy = false; render(); }
  }
  $('[data-update-action]').addEventListener('click', () => void action(state.phase === 'ready' ? 'updateInstall' : 'updateDownload'));
  const unsubscribe = desktop.onUpdateStatus?.(receive);
  render(); void refresh();
  const poll = setInterval(() => void refresh(), 2000);
  window.addEventListener('pagehide', () => { clearInterval(poll); clearTimeout(timer); unsubscribe?.(); }, { once: true });
  return { close };
}
