import { icon } from './icons.js';

export function createUpdates({ desktop, format = 'popover' }) {
  let trigger = document.getElementById('open-updates');
  if (!trigger && format === 'notification' && desktop?.updateStatus) {
    trigger = document.createElement('button'); trigger.id = 'open-updates'; trigger.className = 'entry-updates-trigger';
    trigger.innerHTML = `${icon('download')}<span class="update-dot" hidden></span>`;
    trigger.setAttribute('aria-label', 'Updates'); trigger.setAttribute('aria-expanded', 'false'); document.body.append(trigger);
  }
  if (!trigger || !desktop?.updateStatus) return;
  trigger.hidden = false;
  const panel = document.createElement('section');
  panel.id = 'updates-popover'; panel.className = `updates-popover${format === 'notification' ? ' updates-notification' : ''}`; panel.hidden = true;
  panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-labelledby', 'updates-title');
  panel.innerHTML = `<header><span class="updates-emblem">${icon('download')}</span><div><span class="updates-eyebrow">CASE FORGE</span><h2 id="updates-title">Updates</h2></div><button class="updates-close" aria-label="Close updates">${icon('close')}</button></header><div class="updates-body"><div class="updates-version"></div><h3 class="updates-heading"></h3><p class="updates-status" role="status" aria-live="polite"></p><progress max="100" aria-label="Update download progress" hidden></progress><section class="updates-message"><span>MESSAGE FROM THE CASE FORGE TEAM</span><p></p></section><p class="updates-footnote">Your case files stay on this computer. You choose when to restart.</p></div><footer><button class="btn" data-update-check>Check for updates</button><button class="btn primary" data-update-action hidden></button></footer>`;
  document.body.append(panel);
  const $ = selector => panel.querySelector(selector);
  let state = { phase: 'idle' }, pinned = false, timer, busy = false, focusSuppressed = false, announced = '';
  function position() { const r = trigger.getBoundingClientRect(); panel.style.left = `${Math.max(12, Math.min(r.right - panel.offsetWidth, window.innerWidth - panel.offsetWidth - 12))}px`; panel.style.top = `${Math.min(r.bottom + 10, window.innerHeight - 180)}px`; panel.style.maxHeight = `${Math.max(160, window.innerHeight - r.bottom - 22)}px`; }
  function render() {
    const phase = state.phase;
    $('.updates-footnote').textContent = state.required ? 'Required by your administrator before opening a case. Save any unfinished work, then restart to install.' : 'Your case files stay on this computer. You choose when to restart.';
    $('#updates-title').textContent = state.required ? 'Required update' : 'Updates';
    $('.updates-version').textContent = `Installed version ${state.currentVersion || '—'}${state.version ? `  →  ${state.version}` : ''}`;
    $('.updates-heading').textContent = ({ idle: 'Ready when you are', checking: 'Checking for updates…', current: 'You’re up to date', available: 'A new update is available', downloading: 'Downloading your update', ready: 'Ready to install', installing: 'Opening the installer…', error: 'Update interrupted', unavailable: 'Development preview' })[phase] || 'Updates';
    $('.updates-status').textContent = state.error || ({ available: 'Read the message below, then download when you’re ready.', downloading: `${Math.round(state.progress || 0)}% downloaded`, ready: 'The download has been verified. Restart when it suits you.', current: 'You have the latest published version.', unavailable: 'Update downloads are available in the installed Windows app.' })[phase] || '';
    $('progress').hidden = phase !== 'downloading'; $('progress').value = state.progress || 0;
    $('.updates-message p').textContent = state.message || 'Release news and a message from the Case Forge team will appear here when an update is published.';
    const action = $('[data-update-action]'); action.hidden = !['available', 'ready'].includes(phase); action.textContent = phase === 'ready' ? 'Restart and install' : 'Download update'; action.disabled = busy;
    $('[data-update-check]').disabled = busy || ['checking', 'downloading', 'installing', 'ready', 'unavailable'].includes(phase);
    const available = ['available', 'downloading', 'ready'].includes(phase);
    trigger.querySelector('.update-dot').hidden = !available;
    trigger.setAttribute('aria-label', available ? 'Updates — new version available' : 'Updates');
    const notice = `${state.version}:${state.required}`;
    if (state.version && (format === 'notification' || state.required) && notice !== announced) {
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
  $('[data-update-check]').addEventListener('click', () => void action('updateCheck'));
  $('[data-update-action]').addEventListener('click', () => void action(state.phase === 'ready' ? 'updateInstall' : 'updateDownload'));
  render(); void refresh();
  const poll = setInterval(() => void refresh(), 2000);
  window.addEventListener('pagehide', () => { clearInterval(poll); clearTimeout(timer); }, { once: true });
  return { close };
}
