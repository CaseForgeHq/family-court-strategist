// Only the packaged GitHub provider controls download URLs. The renderer never supplies one.
function createUpdates({ updater, version, enabled, now = () => new Date().toISOString(), onChange = () => {} }) {
  let state = { currentVersion: version, phase: enabled ? 'idle' : 'unavailable', version: null, required: false, message: '', progress: 0, checkedAt: null, error: null };
  let checking = null, downloading = null;
  const status = () => ({ ...state });
  const set = patch => { state = { ...state, ...patch, revision: (state.revision || 0) + 1 }; onChange(status()); };
  const active = () => ['downloading','verifying','ready','restarting','installing'].includes(state.phase);
  const notes = info => {
    const value = Array.isArray(info.releaseNotes) ? info.releaseNotes.map(n => n.note || '').join('\n\n') : info.releaseNotes;
    return String(value || 'A new Case Forge update is available.').replace(/<[^>]*>/g, '').slice(0, 6000);
  };
  if (enabled) {
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowDowngrade = false;
    updater.allowPrerelease = false;
    updater.on('checking-for-update', () => { if (!state.version) set({ phase: 'checking', error: null }); });
    updater.on('update-available', info => { if (!active()) set({ phase: 'available', version: info.version, required: info.caseForgeRequired === true, message: notes(info), progress: 0, error: null, checkedAt: now() }); });
    updater.on('update-not-available', info => { if (!active()) set({ phase: 'current', version: null, required: false, message: '', error: null, checkedAt: now() }); });
    updater.on('download-progress', value => {
      if (!['downloading', 'verifying'].includes(state.phase)) return;
      const percent = Number(value.percent);
      if (!Number.isFinite(percent)) return;
      // Differential reconstruction may fall back to a fresh full download.
      // Use an honest indeterminate phase instead of a backwards percentage.
      const fallback = state.fullDownload || percent < (state.progress || 0);
      set({ phase: percent >= 100 ? 'verifying' : 'downloading', fullDownload: fallback,
        progress: fallback ? null : Math.max(0, Math.min(100, percent)) });
    });
    updater.on('update-downloaded', info => set({ phase: 'ready', version: info.version, message: notes(info), progress: 100, error: null }));
    updater.on('error', () => set({ phase: 'error', error: 'The update could not complete. Check your connection and try again.' }));
  }
  async function check() {
    if (!enabled || downloading || ['ready', 'downloading', 'verifying', 'restarting', 'installing'].includes(state.phase)) return status();
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
    set({ phase: 'downloading', progress: 0, fullDownload: false, error: null });
    downloading = (async () => {
      try { await updater.downloadUpdate(); }
      catch { set({ phase: 'error', error: 'The download could not be verified or completed. Check for updates to retry.' }); }
      finally { downloading = null; }
      return status();
    })();
    return downloading;
  }
  function install() {
    if (!enabled || !['ready', 'restarting'].includes(state.phase)) return false;
    set({ phase: 'installing' }); updater.quitAndInstall(true, true); return true;
  }
  function restarting() { if (state.phase === 'ready') set({ phase: 'restarting', error: null }); }
  function restartBlocked() { if (state.phase === 'restarting') set({ phase: 'ready', error: 'Save your unfinished work, then select Restart and install.' }); }
  return { status, check, download, install, restarting, restartBlocked };
}
function closeForUpdate(target, install) {
  const contents = target.webContents;
  return new Promise((resolve, reject) => {
    const cleanup = () => { target.removeListener('closed', closed); contents.removeListener('will-prevent-unload', blocked); };
    const closed = async () => { cleanup(); try { await install(); resolve(true); } catch (error) { reject(error); } };
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
