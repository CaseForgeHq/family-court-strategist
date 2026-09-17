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
  panel.innerHTML = `<div class="updates-body"><section class="updates-message"><p></p><button class="btn primary" data-update-action hidden title="Download, install and reopen Case Forge">Download</button><button class="updates-close" aria-label="Close updates" title="Close">${icon('close')}</button></section><p class="updates-status" role="status" aria-live="polite" hidden></p><progress max="100" aria-label="Update download progress" hidden></progress></div>`;
  document.body.append(panel);
  const $ = selector => panel.querySelector(selector);
  let state = { phase: 'idle' }, pinned = false, timer, busy = false, focusSuppressed = false, announced = '';
  function position() { const r = trigger.getBoundingClientRect(); panel.style.left = `${Math.max(12, Math.min(r.right - panel.offsetWidth, window.innerWidth - panel.offsetWidth - 12))}px`; panel.style.top = `${Math.min(r.bottom + 10, window.innerHeight - 180)}px`; panel.style.maxHeight = `${Math.max(160, window.innerHeight - r.bottom - 22)}px`; }
  function render() {
    const phase = state.phase;
    panel.setAttribute('aria-label', state.required ? 'Required update message' : 'Update message');
    $('.updates-status').textContent = state.error || '';
    $('.updates-status').hidden = !state.error;
    $('progress').hidden = phase !== 'downloading'; $('progress').value = state.progress || 0;
    $('.updates-message p').textContent = state.message || (phase === 'checking' ? 'Checking for updates…' : 'You’re up to date.');
    const action = $('[data-update-action]');
    action.hidden = !['available', 'downloading', 'ready', 'installing'].includes(phase) && !(phase === 'error' && state.version);
    action.textContent = phase === 'ready' ? 'Restart and install' : phase === 'downloading' ? `Downloading ${Math.round(state.progress || 0)}%` : phase === 'installing' ? 'Installing…' : 'Download';
    action.disabled = busy || ['downloading', 'installing'].includes(phase);
    const available = ['available', 'downloading', 'ready', 'installing'].includes(phase) || (phase === 'error' && Boolean(state.version));
    trigger.hidden = format === 'notification' && !available;
    if (trigger.hidden) close();
    trigger.classList.toggle('has-update', available);
    panel.classList.toggle('has-update', available);
    trigger.querySelector('.update-dot').hidden = !available;
    trigger.setAttribute('aria-label', available ? 'Updates — new version available' : 'Updates');
    const notice = `${state.version}:${state.required}`;
    if (available && state.version && notice !== announced) {
      trigger.classList.remove('update-arrival'); void trigger.offsetWidth; trigger.classList.add('update-arrival');
      panel.classList.remove('update-arrival'); void panel.offsetWidth; panel.classList.add('update-arrival');
      announced = notice; pinned = true; panel.hidden = false; trigger.setAttribute('aria-expanded', 'true');
    }
    if (!panel.hidden) position();
  }
  async function refresh() { try { const result = await desktop.updateStatus(); if (result.error && !result.phase) return; state = result; render(); } catch { /* Keep the last known state during lock or shutdown. */ } }
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
    if (busy) return; busy = true; render();
    try { const result = await desktop[method](); if (result.phase) state = result; else if (result.error) state = { ...state, error: result.error }; }
    catch { state = { ...state, error: 'Could not complete this action. Please try again.' }; }
    finally { busy = false; render(); }
  }
  $('[data-update-action]').addEventListener('click', () => void action(state.phase === 'ready' ? 'updateInstall' : 'updateDownload'));
  render(); void refresh();
  const poll = setInterval(() => void refresh(), 2000);
  window.addEventListener('pagehide', () => { clearInterval(poll); clearTimeout(timer); }, { once: true });
  return { close };
}
