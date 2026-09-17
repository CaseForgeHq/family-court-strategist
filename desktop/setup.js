// Setup uses the isolated desktop bridge and opens a case only after a completed user action.
const $ = (id) => document.getElementById(id);
const desktop = window.strategistDesktop;
const planCatalogue = window.CaseForgePlans;
let state = { pinConfigured: false, folderSelected: false }, busy = false, ready = false;
let preferences = null, preferencesFolderPath = '', draftFolderKey = '';
let pending = '';
let setupUnavailable = false;
let pinEditingExisting = false;
const touchedPins = new Set();
const entry = window.CaseForgeEntry;
const termsScreen = window.CaseForgeTermsScreen;
const complete = () => ready && state.pinConfigured && state.folderSelected;
const preferencesSaved = () => complete() && preferences?.configured === true && preferencesFolderPath === state.folderPath;
function stage(name, focus = true) { entry?.show(name, focus); render(); }
const pinFormat = (value) => /^\d{6,12}$/.test(value);
const validCaseName = () => { const name = $('preferences-case-name').value.trim(); return name.length > 0 && name.length <= 80 && !/[\u0000-\u001f\u007f-\u009f]/u.test(name); };
const chosenPlan = () => document.querySelector('input[name="ai-plan"]:checked')?.value;
const validPlan = () => Object.hasOwn(planCatalogue?.plans || {}, chosenPlan());
const astraSelected = () => Boolean(planCatalogue?.astraUpgrade && chosenPlan() === planCatalogue.astraUpgrade.planId && $('preferences-astra').checked);
if (planCatalogue) {
  for (const plan of Object.values(planCatalogue.plans)) {
    $(`${plan.id}-plan-price`).textContent = `A$${plan.monthlyAud}`;
    $(`${plan.id}-plan-allowance`).textContent = `${plan.dailyTokens / 1_000_000} million`;
    if (plan.dailyInputTokens && plan.dailyOutputTokens) {
      $(`${plan.id}-plan-split`).textContent = `${plan.dailyInputTokens / 1_000_000}M reading + ${plan.dailyOutputTokens / 1_000}k generated.`;
    }
  }
  $('astra-plan-price').textContent = `A$${planCatalogue.astraUpgrade.monthlyAud}`;
  const extra = planCatalogue.astraUpgrade.monthlyAud - planCatalogue.plans[planCatalogue.astraUpgrade.planId].monthlyAud;
  $('astra-price-detail').textContent = `A$${extra} extra · incl. GST`;
}
const pinFormReady = () => pinFormat($('setup-new-pin').value) && $('setup-confirm-pin').value === $('setup-new-pin').value && (!state.pinConfigured || pinFormat($('setup-current-pin').value));
const confirmMoment = () => new Promise((resolve) => setTimeout(resolve, window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : 220));
function paintField(id, feedbackId, status, message) {
  $(id).dataset.status = status; $(id).setAttribute('aria-invalid', String(status === 'error'));
  $(feedbackId).textContent = message;
}
function renderPinFields() {
  for (const [id, feedback] of [['setup-current-pin', 'setup-current-pin-feedback'], ['setup-new-pin', 'setup-new-pin-feedback']]) {
    const value = $(id).value;
    const invalid = value && (/\D/.test(value) || value.length > 12 || touchedPins.has(id) && value.length < 6);
    const status = invalid ? 'error' : pinFormat(value) ? 'ready' : value || document.activeElement === $(id) ? 'active' : 'idle';
    paintField(id, feedback, status, !value ? id === 'setup-current-pin' ? 'Enter your current PIN.' : '6–12 digits.'
      : /\D/.test(value) ? 'Use numbers only.' : !pinFormat(value) ? 'Use 6–12 digits.' : id === 'setup-current-pin' ? 'Ready to check.' : 'Confirm this PIN below.');
  }
  const value = $('setup-confirm-pin').value, matches = value && value === $('setup-new-pin').value && pinFormat(value);
  const mismatch = value && !matches && (touchedPins.has('setup-confirm-pin') || value.length >= $('setup-new-pin').value.length || /\D/.test(value));
  paintField('setup-confirm-pin', 'setup-confirm-pin-feedback', matches ? 'ready' : mismatch ? 'error' : value ? 'active' : 'idle',
    matches ? 'PINs match.' : mismatch ? 'These PINs do not match yet.' : 'Enter the same PIN again.');
}

async function loadAppVersion() {
  const label = $('app-version');
  label.textContent = desktop ? 'Case Forge · version unavailable' : 'Browser preview';
  if (typeof desktop?.getAppInfo !== 'function') return;
  try {
    const info = await desktop.getAppInfo();
    if (typeof info?.version === 'string' && info.version.trim()) label.textContent = `${typeof info.name === 'string' && info.name.trim() ? info.name.trim() : 'Case Forge'} v${info.version.trim()}`;
  } catch { /* Version lookup must not prevent setup or recovery. */ }
}

function render() {
  $('setup-pin-badge').textContent = !ready ? setupUnavailable ? 'Unavailable' : 'Checking…' : state.pinConfigured ? 'PIN active' : 'Not set';
  $('setup-folder-badge').textContent = !ready ? setupUnavailable ? 'Unavailable' : 'Checking…' : state.folderSelected ? 'Selected' : 'Not selected';
  $('setup-pin-card').dataset.status = !ready ? setupUnavailable ? 'error' : 'checking' : state.pinConfigured ? 'success' : 'idle';
  $('setup-folder-card').dataset.status = pending === 'folder' ? 'checking' : !ready ? setupUnavailable ? 'error' : 'checking' : state.folderSelected ? 'success' : 'idle';
  $('setup-pin-status').textContent = state.pinConfigured ? 'Use your PIN to unlock Case Forge.' : 'Choose 6–12 digits to lock the app.';
  $('setup-folder-status').textContent = state.folderSelected ? state.folderName || 'Your case folder' : '';
  $('setup-folder-status').hidden = !state.folderSelected;
  $('setup-folder-path').textContent = state.folderSelected ? state.folderPath || '' : '';
  $('setup-configure-pin').firstChild.textContent = state.pinConfigured ? 'Change PIN ' : 'Configure PIN ';
  const showCurrentPin = $('pin-dialog').open ? pinEditingExisting : state.pinConfigured;
  $('setup-current-wrap').hidden = !showCurrentPin;
  $('setup-current-pin').required = showCurrentPin;
  for (const id of ['setup-configure-pin', 'setup-choose-folder', 'setup-create-folder', 'setup-cancel-pin']) $(id).disabled = !ready || busy;
  $('setup-save-pin').disabled = !ready || busy || !pinFormReady();
  for (const id of ['setup-current-pin', 'setup-new-pin', 'setup-confirm-pin']) $(id).disabled = busy;
  $('setup-pin-form').setAttribute('aria-busy', String(pending === 'pin'));
  $('setup-save-pin').setAttribute('aria-busy', String(pending === 'pin'));
  const pinAction = $('pin-dialog').dataset.status === 'success' ? 'saved' : pending === 'pin' ? 'saving' : 'idle';
  $('setup-save-pin').dataset.state = pinAction;
  $('setup-save-pin-label').textContent = pinAction === 'saved' ? 'PIN saved' : pinAction === 'saving' ? 'Saving PIN…' : 'Save PIN';
  $('setup-reset-app').disabled = busy;
  if ($('configure-continue')) $('configure-continue').disabled = busy || !complete() || $('pin-dialog')?.open;
  if ($('ready-back')) $('ready-back').disabled = busy;
  if ($('ready-open')) {
    $('ready-open').disabled = busy || !preferencesSaved() || !termsScreen?.canContinue();
    $('ready-open').firstChild.textContent = termsScreen?.isAccepted() ? 'Enter Case Forge ' : 'Accept & enter ';
  }
  termsScreen?.setBusy(busy);
  if ($('preferences-back')) $('preferences-back').disabled = busy;
  if ($('preferences-continue')) $('preferences-continue').disabled = busy || !complete() || !preferences || !validCaseName() || !validPlan();
  $('preferences-form').setAttribute('aria-busy', String(pending === 'preferences'));
  $('preferences-continue').setAttribute('aria-busy', String(pending === 'preferences'));
  $('ready-open').setAttribute('aria-busy', String(pending === 'open'));
  for (const input of document.querySelectorAll('#preferences-form input')) input.disabled = busy || !preferences;
  $('astra-preview-status').textContent = astraSelected() ? 'Selected' : 'Choose Astra';
  renderPinFields();
}
async function refresh() {
  if (!desktop?.getSetupState) {
    ready = false; setupUnavailable = true; render(); $('setup-message').textContent = 'Open Case Forge in the desktop app to configure your PIN and case folder.'; return;
  }
  const result = await desktop.getSetupState();
  if (result?.error || !result) throw new Error(result?.error || 'Could not check your workspace settings.');
  if (state.folderPath !== result.folderPath) { preferences = null; preferencesFolderPath = ''; draftFolderKey = ''; }
  await termsScreen?.load();
  state = result; ready = true; setupUnavailable = false; render();
}
async function loadPreferences(focus = true) {
  if (!complete() || busy) return;
  busy = true; stage('preferences', focus); $('preferences-message').textContent = 'Loading your preferences…';
  try {
    if (typeof desktop?.getWorkspacePreferences !== 'function') throw new Error('Your preferences are unavailable. Go back and try again.');
    const result = await desktop.getWorkspacePreferences();
    if (!result?.folderKey || result.error) throw new Error(result?.error || 'Could not load your case preferences.');
    preferences = result; preferencesFolderPath = state.folderPath;
    if (draftFolderKey !== result.folderKey) {
      $('preferences-case-name').value = result.caseName || state.folderName || 'My Case';
      const savedPlan = Object.hasOwn(planCatalogue.plans, result.aiPlan) ? result.aiPlan : 'free';
      for (const input of document.querySelectorAll('input[name="ai-plan"]')) input.checked = input.value === savedPlan;
      $('preferences-astra').checked = result.advancedIntelligence === true && savedPlan === planCatalogue.astraUpgrade.planId;
      draftFolderKey = result.folderKey;
    }
    $('preferences-message').textContent = '';
  } catch (error) { preferences = null; $('preferences-message').textContent = error.message; }
  finally { busy = false; render(); }
}
function clearPins() { for (const id of ['setup-current-pin', 'setup-new-pin', 'setup-confirm-pin']) $(id).value = ''; }
function showPinForm(show) {
  if (show) pinEditingExisting = state.pinConfigured;
  touchedPins.clear();
  clearPins(); $('setup-pin-form').hidden = !show;
  const dialog = $('pin-dialog');
  dialog.dataset.status = 'idle';
  if (show && dialog && !dialog.open) dialog.showModal();
  if (!show && dialog?.open) dialog.close();
  $('setup-pin-message').textContent = ''; render();
  if (show) $(state.pinConfigured ? 'setup-current-pin' : 'setup-new-pin').focus();
}
$('setup-configure-pin').addEventListener('click', () => { if (ready && !busy) showPinForm(true); });
$('setup-cancel-pin').addEventListener('click', () => { if (!busy) showPinForm(false); });
$('setup-pin-form').addEventListener('submit', async (event) => {
  event.preventDefault(); if (!ready || busy) return;
  if (!pinFormReady()) { for (const id of ['setup-current-pin', 'setup-new-pin', 'setup-confirm-pin']) touchedPins.add(id); render(); return; }
  const input = { currentPin: $('setup-current-pin').value, newPin: $('setup-new-pin').value, confirmation: $('setup-confirm-pin').value };
  busy = true; pending = 'pin'; $('pin-dialog').dataset.status = 'checking'; render(); $('setup-pin-message').textContent = 'Saving your PIN…';
  try {
    const result = await desktop.configurePin(input);
    if (!result?.ok) throw new Error(result?.error || 'Your PIN could not be saved. Please try again.');
    clearPins(); await refresh();
    if (!state.pinConfigured) throw new Error('Your PIN status could not be confirmed. Please try again.');
    pending = ''; $('pin-dialog').dataset.status = 'success'; $('setup-pin-message').textContent = 'PIN saved.'; render();
    await confirmMoment(); showPinForm(false); $('setup-message').textContent = state.folderSelected ? '' : 'PIN saved. Choose a folder to continue.';
  } catch (error) { clearPins(); touchedPins.clear(); $('pin-dialog').dataset.status = 'error'; $('setup-pin-message').textContent = error.message; }
  finally { busy = false; pending = ''; render(); if ($('pin-dialog').open) $(state.pinConfigured ? 'setup-current-pin' : 'setup-new-pin').focus(); }
});
for (const id of ['setup-current-pin', 'setup-new-pin', 'setup-confirm-pin']) {
  $(id).addEventListener('input', () => { if (!busy) { $('setup-pin-message').textContent = ''; $('pin-dialog').dataset.status = 'idle'; render(); } });
  $(id).addEventListener('blur', () => { if (!busy) { touchedPins.add(id); render(); } });
  $(id).addEventListener('focus', () => { if (!busy) renderPinFields(); });
}
$('pin-dialog')?.addEventListener('cancel', (event) => { event.preventDefault(); if (!busy) showPinForm(false); });
async function chooseFolder(create = false) {
  if (!ready || busy) return;
  busy = true; pending = 'folder'; render(); $('setup-message').textContent = 'Choosing your case folder…';
  let selected = false;
  try {
    const result = await (create ? desktop.createCase() : desktop.chooseCaseFolder());
    if (result?.error) throw new Error(result.error);
    await refresh(); selected = result === true;
    $('setup-message').textContent = selected && !state.pinConfigured ? 'Folder selected. Set your PIN to continue.' : '';
  } catch (error) { $('setup-message').textContent = error.message; }
  finally { busy = false; pending = ''; render(); }
}
$('setup-choose-folder').addEventListener('click', () => void chooseFolder());
$('setup-create-folder').addEventListener('click', () => void chooseFolder(true));
async function openWorkspace() {
  if (!preferencesSaved() || !termsScreen?.canContinue() || busy || !$('setup-pin-form').hidden || entry?.getStage() !== 'ready') return;
  busy = true; pending = 'open'; render(); $('ready-message').textContent = 'Opening Case Forge…';
  try {
    await termsScreen.accept();
    const result = await desktop.openWorkspace();
    if (!result?.ok) throw new Error(result?.error || 'Your workspace could not be opened. Please try again.');
  } catch (error) { $('ready-message').textContent = error.message; busy = false; pending = ''; render(); }
}
$('configure-continue')?.addEventListener('click', async () => {
  if (!complete() || busy || $('pin-dialog')?.open) return;
  try { await refresh(); if (complete()) await loadPreferences(); }
  catch (error) { $('setup-message').textContent = error.message; }
});
$('preferences-back')?.addEventListener('click', () => { if (!busy) stage('configure'); });
$('preferences-form')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!complete() || busy || !preferences || entry?.getStage() !== 'preferences') return;
  const caseName = $('preferences-case-name').value.trim();
  // Plan interest is separate from a working provider connection or paid entitlement.
  const preferredProvider = preferences.preferredProvider;
  const aiPlan = chosenPlan(), advancedIntelligence = astraSelected();
  if (!caseName || caseName.length > 80 || /[\u0000-\u001f\u007f-\u009f]/u.test(caseName)) { $('preferences-message').textContent = 'Enter a case name between 1 and 80 characters.'; return; }
  if (!validPlan()) { $('preferences-message').textContent = 'Choose a plan to continue.'; return; }
  busy = true; pending = 'preferences'; render(); $('preferences-message').textContent = 'Saving your preferences…';
  try {
    if (typeof desktop?.saveWorkspacePreferences !== 'function') throw new Error('Your preferences could not be saved. Please try again.');
    const result = await desktop.saveWorkspacePreferences({ folderKey: preferences.folderKey, caseName, preferredProvider, aiPlan, advancedIntelligence });
    if (result?.configured !== true || result.folderKey !== preferences.folderKey || result.aiPlan !== aiPlan || result.advancedIntelligence !== advancedIntelligence || result.error) throw new Error(result?.error || 'Your preferences could not be saved. Please try again.');
    preferences = result; preferencesFolderPath = state.folderPath;
    $('preferences-case-name').value = result.caseName;
    $('preferences-message').textContent = ''; $('ready-message').textContent = ''; stage('ready');
  } catch (error) { $('preferences-message').textContent = error.message; }
  finally { busy = false; pending = ''; render(); }
});
$('preferences-case-name').addEventListener('input', () => { $('preferences-case-name').setAttribute('aria-invalid', 'false'); render(); });
for (const input of document.querySelectorAll('input[name="ai-plan"]')) input.addEventListener('change', () => {
  if (busy || !planCatalogue?.astraUpgrade) return;
  if (input.value !== planCatalogue.astraUpgrade.planId) $('preferences-astra').checked = false;
  $('preferences-message').textContent = ''; render();
});
$('preferences-astra').addEventListener('change', () => {
  if (busy || !planCatalogue?.astraUpgrade) return;
  if ($('preferences-astra').checked) $(`preferences-plan-${planCatalogue.astraUpgrade.planId}`).checked = true;
  $('preferences-message').textContent = ''; render();
});
$('ready-back')?.addEventListener('click', () => { if (!busy) { $('ready-message').textContent = ''; stage('preferences'); } });
$('ready-open')?.addEventListener('click', () => void openWorkspace());
window.addEventListener('caseforge:terms', render);
if (typeof desktop?.resetAppSetup === 'function') {
  $('setup-reset-app').hidden = false;
  $('setup-reset-app').addEventListener('click', async () => {
    if (busy) return;
    busy = true; render();
    let completed = false;
    try {
      const result = await desktop.resetAppSetup();
      completed = result?.ok === true;
      if (!completed && !result?.cancelled) throw new Error(result?.error || 'The app setup could not be reset. Please try again.');
    } catch (error) { $(entry?.getStage() === 'preferences' ? 'preferences-message' : entry?.getStage() === 'ready' ? 'ready-message' : 'setup-message').textContent = error.message; }
    finally { if (!completed) { busy = false; render(); } }
  });
}
void loadAppVersion();
refresh().then(async () => {
  const initial = await desktop?.getEntryStage?.();
  if ((initial === 'preferences' || initial === 'ready') && complete()) await loadPreferences(false);
  else stage('configure', false);
}).catch((error) => { ready = false; setupUnavailable = true; render(); $('setup-message').textContent = error.message; })
  .finally(() => { delete document.body.dataset.entryLoading; window.requestAnimationFrame?.(() => window.requestAnimationFrame?.(() => desktop?.updateBootReady?.())); });
