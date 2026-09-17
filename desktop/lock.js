const $ = (id) => document.getElementById(id);
const security = window.strategistDesktop;
let configured = false, known = false, busy = false, checking = false, verified = false, folderIntent = false;
let retryAfter = 0, statusError = '', inputError = '', refreshTimer;
const validPin = () => /^\d{6,12}$/.test($('pin').value);
function render() {
  const blocked = busy || !known || !configured || retryAfter > 0, value = $('pin').value;
  const status = verified ? 'success' : checking ? 'checking' : retryAfter ? 'waiting' : statusError || inputError ? 'error'
    : value ? validPin() ? 'ready' : 'active' : document.activeElement === $('pin') ? 'active' : 'idle';
  $('lock-pin-card').dataset.status = status;
  $('lock-pin-state').textContent = verified ? 'PIN confirmed' : checking ? 'Checking PIN…' : !known ? 'Unavailable' : configured ? 'PIN active' : 'PIN not set';
  $('pin').dataset.status = status; $('pin').setAttribute('aria-invalid', String(!!inputError));
  $('pin-form').setAttribute('aria-busy', String(checking));
  for (const id of ['pin', 'confirmation', 'show-pin']) $(id).disabled = blocked;
  $('unlock').disabled = blocked;
  $('lock-choose-folder').disabled = blocked || typeof security?.unlockToSetup !== 'function';
  $('lock-reset-setup').disabled = busy;
  $('lock-message').textContent = statusError || (retryAfter ? `Please wait ${retryAfter} seconds before trying again.` : inputError);
  $('pin-entry-feedback').textContent = verified ? 'Confirmed. Opening your settings…' : checking ? 'Checking your PIN…' : !value ? 'Enter 6–12 digits.'
    : /\D/.test(value) ? 'Use numbers only.' : validPin() ? 'Press Enter to confirm.' : `${value.length} digits · at least 6 needed.`;
  $('lock-title').textContent = 'Create Your PIN';
  $('lock-intro').textContent = folderIntent ? 'Confirm your PIN to choose a folder.' : 'Enter your PIN to continue.';
  $('confirm-wrap').hidden = true; $('confirmation').required = false; $('pin-form').hidden = false;
}
async function loadAppVersion() {
  const label = $('app-version'); label.textContent = security ? 'Case Forge · version unavailable' : 'Browser preview';
  if (typeof security?.getAppInfo !== 'function') return;
  try {
    const info = await security.getAppInfo();
    if (typeof info?.version === 'string' && info.version.trim()) label.textContent = `${typeof info.name === 'string' && info.name.trim() ? info.name.trim() : 'Case Forge'} v${info.version.trim()}`;
  } catch { /* Version lookup must not prevent recovery. */ }
}
async function refresh() {
  clearTimeout(refreshTimer);
  try {
    if (typeof security?.securityStatus !== 'function') throw new Error('Open Case Forge in the desktop app to use your PIN.');
    const state = await security.securityStatus();
    if (!state || state.error) throw new Error(state?.error || 'Could not check your PIN status.');
    known = true; configured = state.configured === true;
    const wasWaiting = retryAfter > 0; retryAfter = Math.max(0, Number(state.retryAfter) || 0);
    if (wasWaiting && !retryAfter) inputError = '';
    statusError = configured ? '' : 'Reset app setup to create your PIN.';
    if (retryAfter) refreshTimer = setTimeout(refresh, 1000);
  } catch (error) { known = false; statusError = error.message; }
  render();
}
$('show-pin').addEventListener('click', () => {
  if (busy || $('show-pin').disabled) return;
  const show = $('pin').type === 'password'; $('pin').type = show ? 'text' : 'password';
  $('show-pin').textContent = show ? 'Hide' : 'Show'; $('show-pin').setAttribute('aria-label', show ? 'Hide PIN' : 'Show PIN');
});
$('lock-choose-folder').addEventListener('click', () => {
  if (busy || $('lock-choose-folder').disabled) return;
  folderIntent = true; inputError = ''; $('pin').focus(); render();
});
$('pin').addEventListener('input', () => { if (!busy) { inputError = ''; render(); } });
for (const event of ['focus', 'blur']) $('pin').addEventListener(event, render);
$('pin').addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  event.preventDefault(); if (busy || $('unlock').disabled) return;
  if (!validPin()) { inputError = 'Enter a PIN with 6–12 digits.'; render(); return; }
  $('pin-form').requestSubmit($('unlock'));
});
$('pin-form').addEventListener('submit', async (event) => {
  event.preventDefault(); if (busy || $('unlock').disabled) return;
  if (!validPin()) { inputError = 'Enter a PIN with 6–12 digits.'; render(); return; }
  const pin = $('pin').value;
  busy = checking = true; inputError = ''; $('pin').value = ''; $('confirmation').value = '';
  $('pin').type = 'password'; $('show-pin').textContent = 'Show'; $('show-pin').setAttribute('aria-label', 'Show PIN'); render();
  try {
    const result = await security.unlockToSetup(pin, folderIntent ? 'configure' : 'preferences');
    if (!result?.ok) throw new Error(result?.error || 'Your PIN could not be checked. Please try again.');
    // Only the native verified event can show confirmation; navigation completes the action.
  } catch (error) {
    busy = checking = verified = false; inputError = error.message;
    await refresh(); if (!$('pin').disabled) $('pin').focus();
  }
});
const unsubscribe = security?.onPinVerified?.(() => {
  if (!checking || !busy) return;
  verified = true; checking = false; render();
});
if (typeof security?.resetAppSetup === 'function') {
  $('lock-reset-setup').hidden = false;
  $('lock-reset-setup').addEventListener('click', async () => {
    if (busy) return;
    busy = true; render(); let completed = false;
    try {
      const result = await security.resetAppSetup(); completed = result?.ok === true;
      if (!completed && !result?.cancelled) throw new Error(result?.error || 'The app setup could not be reset. Please try again.');
    } catch (error) { if (statusError) statusError = error.message; else inputError = error.message; }
    finally { if (!completed) { busy = false; render(); } }
  });
}
window.addEventListener('pagehide', () => { clearTimeout(refreshTimer); unsubscribe?.(); });
void loadAppVersion();
refresh().then(() => { if (document.activeElement === document.body && !$('pin').disabled) $('pin').focus(); });
