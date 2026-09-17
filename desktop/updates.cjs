// Only the packaged GitHub provider controls download URLs. The renderer never supplies one.
function createUpdates({ updater, version, enabled, now = () => new Date().toISOString() }) {
  let state = { currentVersion: version, phase: enabled ? 'idle' : 'unavailable', version: null, required: false, message: '', progress: 0, checkedAt: null, error: null };
  let checking = null, downloading = null;
  const status = () => ({ ...state });
  const set = patch => { state = { ...state, ...patch }; };
  const notes = info => {
    const value = Array.isArray(info.releaseNotes) ? info.releaseNotes.map(n => n.note || '').join('\n\n') : info.releaseNotes;
    return String(value || 'A new Case Forge update is available.').replace(/<[^>]*>/g, '').slice(0, 6000);
  };
  if (enabled) {
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowDowngrade = false;
    updater.allowPrerelease = false;
    updater.on('checking-for-update', () => set({ phase: 'checking', error: null }));
    updater.on('update-available', info => set({ phase: 'available', version: info.version, required: info.caseForgeRequired === true, message: notes(info), progress: 0, error: null, checkedAt: now() }));
    updater.on('update-not-available', info => set({ phase: 'current', version: null, required: false, message: notes(info), error: null, checkedAt: now() }));
    updater.on('download-progress', value => set({ phase: 'downloading', progress: Math.max(0, Math.min(100, Number(value.percent) || 0)) }));
    updater.on('update-downloaded', info => set({ phase: 'ready', version: info.version, message: notes(info), progress: 100, error: null }));
    updater.on('error', () => set({ phase: 'error', error: 'The update could not complete. Check your connection and try again.' }));
  }
  async function check() {
    if (!enabled || downloading || ['ready', 'downloading', 'installing'].includes(state.phase)) return status();
    if (!checking) checking = (async () => {
      try { await updater.checkForUpdates(); }
      catch { set({ phase: 'error', error: 'Could not check for updates. Your installed version is still available to use.' }); }
      finally { checking = null; }
      return status();
    })();
    return checking;
  }
  async function download() {
    if (downloading) return downloading;
    if (!enabled || state.phase !== 'available') return status();
    set({ phase: 'downloading', progress: 0, error: null });
    downloading = (async () => {
      try { await updater.downloadUpdate(); }
      catch { set({ phase: 'error', error: 'The download could not be verified or completed. Check for updates to retry.' }); }
      finally { downloading = null; }
      return status();
    })();
    return downloading;
  }
  function install() {
    if (!enabled || state.phase !== 'ready') return false;
    set({ phase: 'installing' }); updater.quitAndInstall(true, true); return true;
  }
  return { status, check, download, install };
}
function closeForUpdate(target, install) {
  const contents = target.webContents;
  return new Promise(resolve => {
    const cleanup = () => { target.removeListener('closed', closed); contents.removeListener('will-prevent-unload', blocked); };
    const closed = () => { cleanup(); install(); resolve(true); };
    const blocked = () => { cleanup(); resolve(false); };
    target.once('closed', closed);
    contents.once('will-prevent-unload', blocked);
    target.close();
  });
}
async function downloadAndInstall(updates, install) {
  if (updates.status().phase === 'error') await updates.check();
  const result = await updates.download();
  return result.phase === 'ready' ? install() : result;
}
module.exports = { createUpdates, closeForUpdate, downloadAndInstall };
