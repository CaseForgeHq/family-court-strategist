const { contextBridge, ipcRenderer } = require('electron');
function listenChatGPT(channel, callback, parse) {
  if (typeof callback !== 'function') return () => {};
  const listener = (_event, value) => { const result = parse(value); if (result) callback(result); };
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}
function chatGPTState(value) {
  if (!value || typeof value !== 'object' || !['available', 'connected', 'signingIn', 'busy'].every(key => typeof value[key] === 'boolean')) return null;
  const result = Object.fromEntries(['available', 'connected', 'signingIn', 'busy'].map(key => [key, value[key]]));
  for (const [key, limit] of [['email',320], ['plan',80], ['model',160], ['scanModel',160], ['error',1000]]) result[key] = typeof value[key] === 'string' ? value[key].slice(0,limit) : null;
  result.checking = value.checking === true;
  result.state = ['unknown','checking','signed_out','signing_in','connected','error'].includes(value.state) ? value.state : 'unknown';
  result.activeScans = Number.isInteger(value.activeScans) && value.activeScans >= 0 && value.activeScans <= 3 ? value.activeScans : 0;
  return result;
}
function chatGPTProgress(value) {
  if (!value || typeof value.requestId !== 'string' || !/^[A-Za-z0-9._:-]{1,160}$/.test(value.requestId) ||
      !['connecting','replying','delta','completed','cancelled','error'].includes(value.phase) ||
      (value.text !== undefined && (typeof value.text !== 'string' || value.text.length > 128000))) return null;
  return { requestId:value.requestId, phase:value.phase, ...(value.text !== undefined ? {text:value.text} : {}) };
}
contextBridge.exposeInMainWorld('strategistDesktop', Object.freeze({
  updateStatus: () => ipcRenderer.invoke('updates:status'),
  updateCheck: () => ipcRenderer.invoke('updates:check'),
  updateDownload: () => ipcRenderer.invoke('updates:download'),
  updateInstall: () => ipcRenderer.invoke('updates:install'),
  updateBootReady: () => ipcRenderer.send('updates:boot-ready'),
  onUpdateStatus: callback => listenChatGPT('updates:status-changed', callback, value =>
    value && ['idle','current','checking','unavailable','available','downloading','verifying', 'preparing','ready','restarting','installing','error'].includes(value.phase) ? value : null),
  previewDocument: value => ipcRenderer.invoke('documents:preview', value),
  saveDocumentPDF: value => ipcRenderer.invoke('documents:save-pdf', value),
  documentHistory: value => ipcRenderer.invoke('documents:history', value),
  getAppInfo: () => ipcRenderer.invoke('app:info'),
  adminStatus: () => ipcRenderer.invoke('admin:status'),
  adminCreateDemo: size => ipcRenderer.invoke('admin:create-demo', size),
  adminOpenDemo: id => ipcRenderer.invoke('admin:open-demo', id),
  adminReturnCase: () => ipcRenderer.invoke('admin:return-case'),
  chatGPTStatus: () => ipcRenderer.invoke('chatgpt:status'),
  chatGPTLogin: () => ipcRenderer.invoke('chatgpt:login'),
  chatGPTCancelLogin: () => ipcRenderer.invoke('chatgpt:cancel-login'),
  chatGPTNewConversation: () => ipcRenderer.invoke('chatgpt:new-conversation'),
  chatGPTOpenLink: value => ipcRenderer.invoke('chatgpt:open-link',value),
  chatGPTLogout: () => ipcRenderer.invoke('chatgpt:logout'),
  chatGPTChat: value => ipcRenderer.invoke('chatgpt:chat',value),
  onChatGPTStatus: callback => listenChatGPT('chatgpt:status-changed', callback, chatGPTState),
  onChatGPTProgress: callback => listenChatGPT('chatgpt:progress', callback, chatGPTProgress),
  deepSearch: value => ipcRenderer.invoke('search:deep', value),
  chatGPTCancel: () => ipcRenderer.invoke('chatgpt:cancel'),
  restoreCaseBackup: () => ipcRenderer.invoke('files:restore-backup'),
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
