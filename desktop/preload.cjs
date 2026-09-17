const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('strategistDesktop', Object.freeze({
  updateStatus: () => ipcRenderer.invoke('updates:status'),
  updateCheck: () => ipcRenderer.invoke('updates:check'),
  updateDownload: () => ipcRenderer.invoke('updates:download'),
  updateInstall: () => ipcRenderer.invoke('updates:install'),
  getAppInfo: () => ipcRenderer.invoke('app:info'),
  adminStatus: () => ipcRenderer.invoke('admin:status'),
  adminCreateDemo: size => ipcRenderer.invoke('admin:create-demo', size),
  adminOpenDemo: id => ipcRenderer.invoke('admin:open-demo', id),
  adminReturnCase: () => ipcRenderer.invoke('admin:return-case'),
  chatGPTStatus: () => ipcRenderer.invoke('chatgpt:status'),
  chatGPTLogin: () => ipcRenderer.invoke('chatgpt:login'),
  chatGPTLogout: () => ipcRenderer.invoke('chatgpt:logout'),
  chatGPTChat: value => ipcRenderer.invoke('chatgpt:chat',value),
  deepSearch: value => ipcRenderer.invoke('search:deep', value),
  chatGPTCancel: () => ipcRenderer.invoke('chatgpt:cancel'),
  googleStatus: () => ipcRenderer.invoke('google:status'),
  googleConfigure: () => ipcRenderer.invoke('google:configure'),
  googleConnect: () => ipcRenderer.invoke('google:connect'),
  googleSync: value => ipcRenderer.invoke('google:sync',value),
  googleDisconnect: () => ipcRenderer.invoke('google:disconnect'),
  getEntryStage: () => ipcRenderer.invoke('app:entry-stage'),
  getScenePreferences: () => ipcRenderer.invoke('scene:preferences'),
  setScenePreferences: (value) => ipcRenderer.invoke('scene:save', value),
  getSceneWeather: (cityId) => ipcRenderer.invoke('scene:weather', cityId),
  openSceneLink: (key) => ipcRenderer.invoke('scene:link', key),
  resetAppSetup: () => ipcRenderer.invoke('setup:reset'),
  chooseCaseFolder: () => ipcRenderer.invoke('vault:choose-folder'),
  createCase: () => ipcRenderer.invoke('vault:new'),
  closeCase: () => ipcRenderer.invoke('vault:close'),
  getSetupState: () => ipcRenderer.invoke('setup:state'),
  getWorkspacePreferences: () => ipcRenderer.invoke('setup:preferences'),
  saveWorkspacePreferences: (value) => ipcRenderer.invoke('setup:save-preferences', value),
  getTermsStatus: () => ipcRenderer.invoke('setup:terms'),
  acceptTerms: (value) => ipcRenderer.invoke('setup:accept-terms', value),
  configurePin: (value) => ipcRenderer.invoke('security:configure', value),
  resetSession: (value) => ipcRenderer.invoke('session:reset', value),
  openWorkspace: () => ipcRenderer.invoke('setup:open'),
  lock: () => ipcRenderer.invoke('security:lock'),
  securityStatus: () => ipcRenderer.invoke('security:status'),
  onPinVerified: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = () => callback();
    ipcRenderer.on('security:verified', listener);
    return () => ipcRenderer.removeListener('security:verified', listener);
  },
  unlock: (pin, confirmation) => ipcRenderer.invoke('security:unlock', pin, confirmation),
  unlockToSetup: (pin, stage) => ipcRenderer.invoke('security:unlock-setup', pin, stage),
}));
let last = 0;
for (const event of ['pointerdown', 'pointermove', 'keydown', 'wheel']) window.addEventListener(event, () => {
  if (Date.now() - last > 1000) { last = Date.now(); ipcRenderer.send('security:activity'); }
}, { passive: true });
