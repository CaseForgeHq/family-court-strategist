const { app, BrowserWindow, dialog, ipcMain, Menu, shell, powerMonitor, net, protocol, session, safeStorage } = require('electron');
const { join, resolve, basename } = require('node:path');
const { pathToFileURL } = require('node:url');
const { readFileSync, writeFileSync, existsSync, mkdirSync, realpathSync, statSync, renameSync } = require('node:fs');
const { randomBytes } = require('node:crypto');
const { PinSecurity } = require('./security.cjs');
const { createWeatherService } = require('./weather.cjs');
const { createScenePreferences } = require('./scene-preferences.cjs');
const { createWorkspacePreferences } = require('./workspace-preferences.cjs');
const { createTermsAcceptance } = require('./terms-acceptance.cjs');
const { createChatGPT, safeExternalUrl } = require('./chatgpt.cjs');
const { createGoogleCalendar } = require('./google-calendar.cjs');
const { createUpdates, closeForUpdate, downloadAndInstall } = require('./updates.cjs');
const { showUpdateHandoff } = require('./update-handoff.cjs');
const { createFastUpdate, markBootReady } = require('./fast-update.cjs');
const { createUpdateMessages } = require('./update-messages.cjs');
const { createDocumentExports } = require('./document-exports.cjs');
const { createDemoCases } = require('./demo-cases.cjs');
// Test profiles never set or read the user's actual PIN. Packaged builds ignore this variable.
if (!app.isPackaged && process.env.CASEFORGE_TEST_USER_DATA) app.setPath('userData', resolve(process.env.CASEFORGE_TEST_USER_DATA));
protocol.registerSchemesAsPrivileged([{ scheme: 'caseforge', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const base = app.isPackaged ? process.resourcesPath : join(__dirname, '..');
const sampleCase = join(base, 'sample-case');
const cfgPath = join(app.getPath('userData'), 'config.json');
const security = new PinSecurity(join(app.getPath('userData'), 'app-lock.json'));
const weather = createWeatherService({ cachePath: join(app.getPath('userData'), 'weather-cache.json') });
const scenePreferences = createScenePreferences(join(app.getPath('userData'), 'scene-preferences.json'), weather.listLocations());
const workspacePreferences = createWorkspacePreferences(join(app.getPath('userData'), 'workspace-preferences.json'));
const termsAcceptance = createTermsAcceptance(join(app.getPath('userData'), 'terms-acceptance.json'));
const chatGPT = createChatGPT({profileDir:join(app.getPath('userData'),'chatgpt'),runtimePath:join(app.isPackaged ? process.resourcesPath : __dirname,'runtime','codex.exe'),openExternal:url=>shell.openExternal(url),version:app.getVersion()});
const googleCalendar = createGoogleCalendar({profileDir:app.getPath('userData'),safeStorage,openExternal:url=>shell.openExternal(url)});
const LOCK_URL = 'caseforge://lock/lock.html';
const SETUP_URL = 'caseforge://lock/setup.html';
let currentVault, win, server, serverPort, capability;
let documentExports;
let demoCases, updates, updateTimer, installingUpdate = false;
let entryStage = 'configure';
let unlocked = false, setupAuthorized = false, operationBusy = false, switchingFolder = false, lastActivity = Date.now(), lockGeneration = 0;
const appOrigin = () => serverPort ? `http://127.0.0.1:${serverPort}` : null;
const appInfo = () => ({ name: 'Case Forge', version: app.isPackaged ? app.getVersion() : require('./package.json').version });
function validFolder(path) { try { return typeof path === 'string' && statSync(path).isDirectory() ? realpathSync(path) : null; } catch { return null; } }
function loadVault() { try { return validFolder(JSON.parse(readFileSync(cfgPath, 'utf8')).vault); } catch { return null; } }
function saveVault(value) {
  const temp = `${cfgPath}.tmp`;
  writeFileSync(temp, JSON.stringify({ vault: value }), { mode: 0o600 });
  renameSync(temp, cfgPath);
}
function isFrame(event) { return win && !win.isDestroyed() && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame; }
function allowedSender(event, screen = 'workspace') {
  if (!isFrame(event)) return false;
  const url = event.senderFrame.url;
  if (screen === 'lock') return url === LOCK_URL;
  if (screen === 'setup') return setupAuthorized && url === SETUP_URL;
  if (screen === 'settings') return allowedSender(event) || allowedSender(event, 'setup');
  return unlocked && new URL(url).origin === appOrigin();
}
function sendChatGPTEvent(channel, value) {
  // Every assistant/card subscriber shares the trusted workspace renderer.
  // Never send account identity or chat text to registration, lock or preview windows.
  if (!unlocked || !win || win.isDestroyed() || win.webContents.isDestroyed()) return;
  try { if (new URL(win.webContents.getURL()).origin !== appOrigin()) return; } catch { return; }
  win.webContents.send(channel, value);
}
chatGPT.subscribe(value => sendChatGPTEvent('chatgpt:status-changed', value));
function setupState() {
  const folder = validFolder(currentVault);
  return { pinConfigured: security.status().configured, folderSelected: !!folder, folderName: folder ? basename(folder) : '', folderPath: folder || '' };
}
function getWorkspacePreferences() {
  if (!security.status().configured) throw new Error('Configure your PIN first.');
  const folder = validFolder(currentVault);
  if (!folder) throw new Error('Choose an available case folder first.');
  return workspacePreferences.get(folder);
}
function saveWorkspacePreferences(value) {
  return operation(() => {
    const current = getWorkspacePreferences();
    if (!value || value.folderKey !== current.folderKey) throw new Error('The case folder changed. Go back and select it again.');
    return workspacePreferences.set(validFolder(currentVault), value);
  });
}
function clearRememberedSetup() {
  saveVault(null);
  try { termsAcceptance.clear(); workspacePreferences.clear(); }
  catch (error) { saveVault(currentVault || null); throw error; }
}
function gateURL() {
  // A damaged verifier stays locked until the user confirms a full setup reset.
  try { if (!security.status().configured) { setupAuthorized = true; return SETUP_URL; } } catch { /* Lock screen reports the error. */ }
  return setupAuthorized ? SETUP_URL : LOCK_URL;
}
function stopServer() {
  documentExports?.close();
  chatGPT.close(); googleCalendar.close();
  unlocked = false; capability = null; serverPort = null;
  if (server) { server.closeWorkspace(); server.close(); server.closeAllConnections(); server = null; }
}
function replaceWindow() {
  if (win && !win.isDestroyed()) {
    // Destroy drafts, document text and beforeunload handlers along with the renderer.
    const previous = win; createWindow(previous.getBounds(), previous.isMinimized()); previous.destroy();
  }
  buildMenu();
}
function lock() {
  entryStage = 'configure'; lockGeneration++; lastActivity = Date.now(); setupAuthorized = false; stopServer(); replaceWindow(); return true;
}
async function operation(task) {
  if (operationBusy) return { error: 'Please finish the current action first.' };
  operationBusy = true;
  try { return await task(lockGeneration); }
  catch (error) { return { error: error.message }; }
  finally { operationBusy = false; }
}
function assertCurrent(generation) { if (generation !== lockGeneration) throw new Error('The workspace locked. Enter your PIN again.'); }
async function startWorkspace(generation) {
  assertCurrent(generation);
  await updates?.check();
  assertCurrent(generation);
  if (updates?.status().required) throw new Error('An administrator requires an update. Download and install it from the update notification before opening your case.');
  if (!setupAuthorized || !security.status().configured) throw new Error('Configure your PIN first.');
  if (!validFolder(currentVault)) throw new Error('Choose an available case folder first.');
  if (!getWorkspacePreferences().configured) throw new Error('Save your case preferences first.');
  if (!termsAcceptance.get().accepted) throw new Error('Review and accept the beta terms on page 03 first.');
  const { createServer } = await import(pathToFileURL(join(base, 'app', 'server.js')).href);
  const { FileReferences } = await import(pathToFileURL(join(base,'app','lib','file-references.js')).href);
  assertCurrent(generation);
  // Recheck after the module loads in case a removable drive was disconnected.
  if (!validFolder(currentVault)) throw new Error('Your case folder is unavailable. Choose it again.');
  capability = randomBytes(32).toString('hex');
  server = createServer(() => currentVault, {
    openNativeDocument: file => shell.openPath(file),
    scanDocument:(request,options)=>chatGPT.scan(request,options),
    fileReferences:new FileReferences({root:app.getPath('userData'),relativePath:'file-references.json'}),
    desktopToken: capability, isUnlocked: () => unlocked, enableClaudeCode: false,
    getWorkspacePreferences: (root) => workspacePreferences.get(root),
    isSample: (root) => root === validFolder(sampleCase) || root === validFolder(join(app.getPath('userData'), 'Example Case')) || demoCases?.isDemo(root) === true,
    getAccess: (root) => ({ canWrite: unlocked && root !== validFolder(sampleCase), mode: 'local-beta', message: 'Local desktop preview · saved on this computer' }),
  });
  const startingServer = server;
  try {
    await new Promise((r, reject) => { startingServer.once('error', reject); startingServer.listen(0, '127.0.0.1', r); });
    assertCurrent(generation);
    if (server !== startingServer) throw new Error('The workspace locked. Enter your PIN again.');
    serverPort = server.address().port; unlocked = true; setupAuthorized = false; lastActivity = Date.now(); buildMenu();
    await win.loadURL(appOrigin()); return { ok: true };
  } catch (error) { if (server === startingServer) { stopServer(); setupAuthorized = generation === lockGeneration; } throw error; }
}
async function enterSetup(generation, stage = 'configure') {
  assertCurrent(generation); setupAuthorized = true; lastActivity = Date.now();
  entryStage = stage === 'configure' || !validFolder(currentVault) ? 'configure' : 'preferences';
  try {
    await win.loadURL(SETUP_URL); assertCurrent(generation); buildMenu(); return { ok: true };
  } catch (error) { if (generation === lockGeneration) setupAuthorized = false; throw error; }
}
function unlockToSetup(pin, stage) {
  return operation(async (generation) => {
    security.verify(pin);
    const recipient = win;
    recipient.webContents.send('security:verified');
    // Show confirmation briefly while keeping setup inaccessible until rechecked.
    await new Promise((resolve) => setTimeout(resolve, 220));
    assertCurrent(generation);
    if (win !== recipient || recipient.isDestroyed()) throw new Error('The workspace locked. Enter your PIN again.');
    return enterSetup(generation, stage);
  });
}
function unlock(pin) {
  return operation(async (generation) => {
    security.verify(pin); setupAuthorized = true;
    if (!validFolder(currentVault)) { currentVault = null; return enterSetup(generation); }
    if (!getWorkspacePreferences().configured) return enterSetup(generation, 'preferences');
    if (!termsAcceptance.get().accepted) return enterSetup(generation, 'preferences');
    return startWorkspace(generation);
  });
}
function configurePin(value) {
  return operation(() => {
    if (!value || typeof value !== 'object') throw new Error('Enter your PIN details.');
    if (security.status().configured) security.change(value.currentPin, value.newPin, value.confirmation);
    else security.setup(value.newPin, value.confirmation);
    lastActivity = Date.now(); return { ok: true };
  });
}
function resetSession(value) {
  return operation(() => {
    if (!value || value.confirmed !== true) throw new Error('Confirm Start fresh before resetting your session.');
    security.reset(value.currentPin, clearRememberedSetup);
    entryStage = 'configure'; currentVault = null; lockGeneration++; setupAuthorized = true; stopServer(); replaceWindow();
    return { ok: true };
  });
}
function resetAppSetup() {
  return operation(async (generation) => {
    const result = await dialog.showMessageBox(win, {
      type: 'warning', title: 'Reset Case Forge setup',
      message: 'Reset the PIN and start setup again?',
      detail: 'Your saved case files will stay in their current folders. Case Forge will clear its PIN, remembered folder, case preferences and current session. You will choose a new PIN and select a case folder again. The old PIN is not required.',
      buttons: ['Keep current setup', 'Reset app setup'], defaultId: 0, cancelId: 0,
      checkboxLabel: 'I understand that my PIN and app setup will be cleared.', checkboxChecked: false,
      noLink: true,
    });
    assertCurrent(generation);
    if (result.response !== 1 || result.checkboxChecked !== true) return { cancelled: true };
    security.clearSetup(clearRememberedSetup);
    entryStage = 'configure'; currentVault = null; lockGeneration++; lastActivity = Date.now(); setupAuthorized = true;
    stopServer(); replaceWindow(); return { ok: true };
  });
}
async function selectFolder(create, fromMenu = false) {
  const result = await operation(async (generation) => {
    const result = create
      ? await dialog.showSaveDialog(win, { title: 'Choose a name and location for your case folder', defaultPath: join(app.getPath('documents'), 'My Case'), buttonLabel: 'Create case folder' })
      : await dialog.showOpenDialog(win, { title: 'Choose your case folder', properties: ['openDirectory'] });
    assertCurrent(generation);
    if (result.canceled) return false;
    const path = create ? result.filePath : result.filePaths[0];
    if (!path) return false;
    if (create) {
      if (existsSync(path)) throw new Error('This location already exists. Choose an existing folder or use a new folder name.');
      mkdirSync(path, { recursive: true });
      writeFileSync(join(path, 'CASE-DETAILS.md'), '# My Case\n\nYour private case workspace. Start by adding a document in Files & AI.\n');
    }
    const folder = validFolder(path);
    if (!folder) throw new Error('That folder is unavailable. Choose another folder.');
    return switchCaseFolder(folder, generation, fromMenu);
  });
  return result;
}
async function switchCaseFolder(folder, generation, fromMenu = false) {
    assertCurrent(generation);
    const wasWorkspace = unlocked;
    if (wasWorkspace && folder === currentVault) return false;
    if (wasWorkspace) {
      // Let unsaved-draft cancellation happen before changing the saved folder
      // or stopping the live case service.
      setupAuthorized = true; switchingFolder = true;
      try { await win.loadURL(SETUP_URL); assertCurrent(generation); }
      catch (error) { if (unlocked) setupAuthorized = false; if (generation === lockGeneration) return false; throw error; }
      finally { switchingFolder = false; }
      stopServer();
    }
    saveVault(folder); currentVault = folder;
    if (wasWorkspace) {
      setupAuthorized = true;
      if (folder && getWorkspacePreferences().configured && termsAcceptance.get().accepted) await startWorkspace(generation);
      else await enterSetup(generation, folder ? 'preferences' : 'configure');
    } else if (fromMenu) await enterSetup(generation);
    return true;
}
function createWindow(bounds, minimized = false) {
  win = new BrowserWindow({ width: 1320, height: 880, minWidth: 820, minHeight: 650, ...bounds,
    title: `Case Forge v${appInfo().version} Beta`, backgroundColor: '#F8F4EC', show: false, autoHideMenuBar: true, icon: join(__dirname, process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true,
      partition: 'caseforge-private', preload: join(__dirname, 'preload.cjs'), devTools: !app.isPackaged },
  });
  const current = win;
  let initialMinimize = minimized;
  current.webContents.on('page-title-updated', (event, title) => { event.preventDefault(); current.setTitle(`${title} · v${appInfo().version} Beta`); });
  current.webContents.on('will-prevent-unload', (event) => {
    if (!unlocked && !installingUpdate) event.preventDefault();
    else if (switchingFolder && dialog.showMessageBoxSync(current, {
      type: 'question', title: 'Switch case folders?', message: 'There is unsaved work in this case.',
      detail: 'Switching folders will discard unsaved edits. Saved case files will stay in their current folder.',
      buttons: ['Keep working', 'Discard edits and switch'], defaultId: 0, cancelId: 0,
    }) === 1) event.preventDefault();
  });
  current.webContents.on('will-navigate', (event, url) => { if (url !== LOCK_URL && !(setupAuthorized && url === SETUP_URL) && !(unlocked && new URL(url).origin === appOrigin())) event.preventDefault(); });
  current.webContents.on('will-redirect', (event) => event.preventDefault());
  current.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  current.webContents.on('before-input-event', () => { lastActivity = Date.now(); });
  current.on('minimize', () => {
    if (initialMinimize) { initialMinimize = false; return; }
    if (unlocked || setupAuthorized) { setupAuthorized = false; stopServer(); setImmediate(lock); }
  });
  current.on('closed', () => { if (win === current) { lockGeneration++; win = null; setupAuthorized = false; stopServer(); } });
  current.once('ready-to-show', () => { if (minimized) current.minimize(); else current.show(); });
  current.loadURL(gateURL());
}
function buildMenu() {
  const canConfigure = unlocked || setupAuthorized;
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { label: 'File', submenu: [
      { label: 'New case…', accelerator: 'CmdOrCtrl+N', enabled: canConfigure, click: () => selectFolder(true, true) },
      { label: 'Open case folder…', accelerator: 'CmdOrCtrl+O', enabled: canConfigure, click: () => selectFolder(false, true) },
      { type: 'separator' }, { label: 'Lock workspace', accelerator: 'CmdOrCtrl+Shift+L', enabled: canConfigure, click: lock },
      { type: 'separator' }, { role: 'quit' },
    ] },
    { label: 'View', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] },
    { role: 'help', submenu: [{ label: 'About Case Forge', click: () => dialog.showMessageBox(win, { type: 'info', title: 'Case Forge', message: `Case Forge v${appInfo().version}`, detail: 'Your files, on your computer. This desktop preview organises documents and helps review AI findings. Local AI uses a separately installed Ollama model. Optional cloud AI sends selected document text and source details with your confirmation. Your PIN locks the app, not the case files outside it. Back up your entire case folder. Case Forge does not provide legal advice.' }) },
      { label: 'Project website', click: () => shell.openExternal('https://caseforgehq.com/') }] },
  ]));
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(async () => {
    const { generateDemo, DEMO_PRESETS } = await import(pathToFileURL(join(base, 'app/lib/demo-data.js')).href);
    const { FileReferences } = await import(pathToFileURL(join(base, 'app/lib/file-references.js')).href);
    demoCases = createDemoCases({ profileDir: app.getPath('userData'), presets: DEMO_PRESETS,
      generate: value => generateDemo({ ...value, fileReferences: new FileReferences({ root: app.getPath('userData'), relativePath: 'file-references.json' }) }) });
    mkdirSync(app.getPath('userData'), { recursive: true });
    currentVault = loadVault();
    const privateSession = session.fromPartition('caseforge-private');
    privateSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    privateSession.setPermissionCheckHandler(() => false);
    privateSession.protocol.handle('caseforge', (request) => {
      const url = new URL(request.url), name = decodeURIComponent(url.pathname).replace(/^\//, '');
      if (url.hostname === 'lock' && ['updates.js', 'updates.css', 'icons.js', 'updates-entry.js'].includes(name)) return net.fetch(pathToFileURL(join(base, 'app', 'public', name)).href);
      const allowed = ['terms.js', 'terms.css', 'terms-screen.js', 'entry-flow.js', 'scene-controls.js', 'scene-controls.css', 'onboarding.css', 'glass-effects.js', 'scene-time.js', 'landscape.js', 'landscape.css', 'lock.html', 'lock.css', 'lock.js', 'setup.html', 'setup.css', 'setup.js', 'ai-plans.js', 'plans.css', 'brand/logo.svg', 'brand/logo-reversed.svg', 'brand/fonts/InterVariable.woff2', 'brand/fonts/EBGaramond-Variable.ttf', 'fonts/Ubuntu-Regular.ttf', 'fonts/Quicksand-VariableFont_wght.ttf'];
      if (url.hostname !== 'lock' || !allowed.includes(name)) return new Response('Not found', { status: 404 });
      return net.fetch(pathToFileURL(join(__dirname, name)).href);
    });
    privateSession.webRequest.onBeforeSendHeaders((details, callback) => {
      const headers = { ...details.requestHeaders };
      if (unlocked && capability && details.webContentsId === win?.webContents.id && new URL(details.url).origin === appOrigin()) headers['X-CaseForge-Desktop'] = capability;
      callback({ requestHeaders: headers });
    });
    privateSession.webRequest.onBeforeRequest((details, callback) => {
      const url = new URL(details.url);
      callback({ cancel: !(['caseforge:', 'devtools:'].includes(url.protocol) || (url.protocol === 'file:' && details.webContentsId === -1) || (unlocked && url.origin === appOrigin())) });
    });
    ipcMain.handle('security:status', (event) => { if (!allowedSender(event, 'lock')) return { error: 'Access denied.' }; try { return security.status(); } catch (error) { return { error: error.message }; } });
    ipcMain.handle('app:info', (event) => allowedSender(event, 'lock') || allowedSender(event, 'settings') ? appInfo() : { error: 'Access denied.' });
    ipcMain.handle('app:entry-stage', (event) => allowedSender(event, 'setup') ? entryStage : { error: 'Access denied.' });
    const entrySender = (event) => allowedSender(event, 'lock') || allowedSender(event, 'settings');
    ipcMain.handle('scene:preferences', (event) => entrySender(event) ? { ...scenePreferences.get(), locations: weather.listLocations() } : { error: 'Access denied.' });
    ipcMain.handle('scene:save', (event, value) => {
      if (!entrySender(event)) return { error: 'Access denied.' };
      try { return scenePreferences.set(value); } catch (error) { return { error: error.message }; }
    });
    ipcMain.handle('scene:weather', async (event, cityId) => {
      if (!entrySender(event)) return { error: 'Access denied.' };
      const prefs = scenePreferences.get();
      if (!prefs.weatherEnabled || prefs.cityId !== cityId) return { disabled: true };
      try { return await weather.get(cityId); } catch (error) { return { error: error.message }; }
    });
    ipcMain.handle('scene:link', (event, key) => {
      if (!entrySender(event)) return false;
      const links = { source: 'https://www.met.no/en', license: 'https://creativecommons.org/licenses/by/4.0/' };
      if (typeof key !== 'string' || !Object.hasOwn(links, key)) return false;
      return shell.openExternal(links[key]).then(() => true, () => false);
    });
    ipcMain.handle('setup:reset', (event) => allowedSender(event, 'lock') || allowedSender(event, 'setup') ? resetAppSetup() : { error: 'Access denied.' });
    ipcMain.handle('security:unlock', (event, pin) => allowedSender(event, 'lock') ? unlock(pin) : { error: 'Access denied.' });
    ipcMain.handle('security:unlock-setup', (event, pin, stage) => allowedSender(event, 'lock') ? unlockToSetup(pin, stage) : { error: 'Access denied.' });
    ipcMain.handle('security:lock', (event) => allowedSender(event, 'settings') ? lock() : false);
    ipcMain.handle('setup:state', (event) => { if (!allowedSender(event, 'settings')) return { error: 'Access denied.' }; try { return setupState(); } catch (error) { return { error: error.message }; } });
    ipcMain.handle('setup:preferences', (event) => { if (!allowedSender(event, 'settings')) return { error: 'Access denied.' }; try { return getWorkspacePreferences(); } catch (error) { return { error: error.message }; } });
    ipcMain.handle('setup:save-preferences', (event, value) => allowedSender(event, 'settings') ? saveWorkspacePreferences(value) : { error: 'Access denied.' });
    ipcMain.handle('setup:terms', (event) => allowedSender(event, 'setup') ? termsAcceptance.get() : { error: 'Access denied.' });
    ipcMain.handle('setup:accept-terms', (event, value) => allowedSender(event, 'setup') ? operation(() => {
      if (!getWorkspacePreferences().configured) throw new Error('Save your case preferences first.');
      return termsAcceptance.accept(value);
    }) : { error: 'Access denied.' });
    ipcMain.handle('setup:open', (event) => allowedSender(event, 'setup') ? operation(startWorkspace) : { error: 'Access denied.' });
    ipcMain.handle('security:configure', (event, value) => allowedSender(event, 'settings') ? configurePin(value) : { error: 'Access denied.' });
    ipcMain.handle('session:reset', (event, value) => allowedSender(event) ? resetSession(value) : { error: 'Access denied.' });
    ipcMain.on('security:activity', (event) => { if (allowedSender(event, 'settings')) lastActivity = Date.now(); });
    ipcMain.handle('vault:choose-folder', (event) => allowedSender(event, 'settings') ? selectFolder(false) : false);
    ipcMain.handle('vault:new', (event) => allowedSender(event, 'settings') ? selectFolder(true) : false);
    ipcMain.handle('vault:close', event => allowedSender(event) ? operation(generation => switchCaseFolder(null, generation)) : { error: 'Unlock your workspace first.' });
    const workspaceIPC = (name, action) => ipcMain.handle(name, async (event,value) => {
      if(!allowedSender(event)) return {error:'Unlock your workspace first.'};
      const generation = lockGeneration;
      try { const result = await action(value); assertCurrent(generation); return result; }
      catch(error) { return {error:error.message || 'The connection could not complete.'}; }
    });
    documentExports = createDocumentExports({ base, tempPath: join(app.getPath('temp'), 'caseforge-documents'), getWindow: () => win, getContext: () => unlocked && currentVault ? { root: currentVault, caseKey: require('node:crypto').createHash('sha256').update(currentVault).digest('hex') } : null });
    workspaceIPC('documents:preview', value => documentExports.preview(value));
    workspaceIPC('documents:save-pdf', value => documentExports.save(value));
    workspaceIPC('documents:history', value => documentExports.history(value));
    const fastUpdate = createFastUpdate({ resources: process.resourcesPath, executable: process.execPath, temp: app.getPath('temp'), userData: app.getPath('userData'), electron: process.versions.electron });
    updates = createUpdates({ updater: app.isPackaged ? require('electron-updater').autoUpdater : null, version: appInfo().version, enabled: app.isPackaged && process.platform === 'win32',
      messages: app.isPackaged ? createUpdateMessages({ userData: app.getPath('userData'), version: appInfo().version, fetch: (...args) => net.fetch(...args) }) : null,
      prepareFast: input => app.isPackaged ? fastUpdate.prepare(input) : null,
      installFast: async plan => { await fastUpdate.launch(plan); app.quit(); return true; },
      onChange: state => { if (win && !win.isDestroyed()) win.webContents.send('updates:status-changed', state); } });
    const updateIPC = (name, action) => ipcMain.handle(name, async event => {
      if (!entrySender(event)) return { error: 'Access denied.' };
      try { return await action(event); } catch { return { error: 'The update could not complete. Please try again.' }; }
    });
    updateIPC('updates:status', () => updates.status());
    ipcMain.on('updates:boot-ready', event => { if (app.isPackaged && entrySender(event)) void markBootReady({ resources: process.resourcesPath, version: appInfo().version }); });
    updateIPC('updates:check', () => updates.check());
    const installVerifiedUpdate = async event => {
      if (!entrySender(event) || updates.status().phase !== 'ready' || installingUpdate) return updates.status();
      const target = win;
      installingUpdate = true;
      updates.restarting();
      try {
        const closed = await closeForUpdate(target, async () => {
          if (app.isPackaged && !updates.status().fast) {
            try { await showUpdateHandoff({ runtime: join(process.resourcesPath, 'runtime'), temp: app.getPath('temp'), executable: process.execPath, pid: process.pid, fromVersion: appInfo().version, toVersion: updates.status().version }); }
            catch { /* A missing status window must never block a verified update. */ }
          }
          await updates.install();
        });
        if (!closed) {
          installingUpdate = false;
          updates.restartBlocked();
          return updates.status();
        }
        return { installed: true };
      } catch (error) { installingUpdate = false; updates.restartBlocked(); throw error; }
    };
    updateIPC('updates:download', event => downloadAndInstall(updates, () => installVerifiedUpdate(event)));
    updateIPC('updates:install', installVerifiedUpdate);
    void updates.refreshMessages(true);
    let lastMetadataCheck = 0, lastMessageVersion = '';
    const refreshUpdates = async () => {
      const state = await updates.refreshMessages();
      const newest = state.notices[0]?.version || '';
      if (Date.now() - lastMetadataCheck >= 60000 || newest !== lastMessageVersion) {
        lastMetadataCheck = Date.now(); lastMessageVersion = newest;
        void updates.check();
      }
    };
    const firstUpdateCheck = setTimeout(refreshUpdates, 1500); firstUpdateCheck.unref();
    updateTimer = setInterval(refreshUpdates, 10 * 1000); updateTimer.unref();
    workspaceIPC('admin:status', () => {
      const state = demoCases.status(currentVault);
      return { ...state, returnName: state.returnFolder ? workspacePreferences.get(state.returnFolder).caseName : null, canReturn: !!state.returnFolder, returnFolder: undefined };
    });
    workspaceIPC('admin:create-demo', size => operation(async generation => {
      const demo = await demoCases.create(size, () => assertCurrent(generation));
      workspacePreferences.set(demo.path, { caseName: demo.label, preferredProvider: 'ollama', aiPlan: 'free', advancedIntelligence: false });
      return { id: demo.id };
    }));
    workspaceIPC('admin:open-demo', id => operation(async generation => {
      const folder = demoCases.openPath(id);
      if (folder !== currentVault) demoCases.rememberReturn(currentVault);
      return { opened: await switchCaseFolder(folder, generation) };
    }));
    workspaceIPC('admin:return-case', () => operation(async generation => ({ opened: await switchCaseFolder(demoCases.returnPath(), generation) })));
    workspaceIPC('chatgpt:status',()=>chatGPT.status());
    workspaceIPC('chatgpt:login',()=>chatGPT.login());
    workspaceIPC('chatgpt:cancel-login',()=>chatGPT.cancelLogin());
    workspaceIPC('chatgpt:new-conversation',()=>chatGPT.newConversation());
    workspaceIPC('chatgpt:open-link',async value=>{ await shell.openExternal(safeExternalUrl(value)); return {opened:true}; });
    workspaceIPC('chatgpt:logout',()=>chatGPT.logout());
    workspaceIPC('chatgpt:chat',value=>{
      const generation=lockGeneration, workspace=server, target=win;
      return chatGPT.chat(value,{onProgress:progress=>{
        if(generation===lockGeneration && server===workspace && win===target)sendChatGPTEvent('chatgpt:progress',progress);
      }});
    });
    workspaceIPC('search:deep', async value => {
      const workspace = server;
      const review = await workspace.takeSearchReview(value);
      const answer = await chatGPT.chat({ text: review.text }, { isolated: true });
      if (server !== workspace) throw new Error('The case changed during this search.');
      return { ...answer, sources: review.sources };
    });
    workspaceIPC('chatgpt:cancel',()=>chatGPT.cancel());
    workspaceIPC('files:restore-backup',()=>operation(async generation=>{
      const source=await dialog.showOpenDialog(win,{title:'Choose a Case Forge backup folder containing manifest.json',properties:['openDirectory']});
      assertCurrent(generation);if(source.canceled)return {cancelled:true};
      const target=await dialog.showOpenDialog(win,{title:'Choose an empty folder for the restored case',properties:['openDirectory','createDirectory']});
      assertCurrent(generation);if(target.canceled)return {cancelled:true};
      const {restoreCaseBackup}=await import(pathToFileURL(join(base,'app','lib','case-database.js')).href);
      assertCurrent(generation);
      return {restored:true,...restoreCaseBackup(source.filePaths[0],target.filePaths[0])};
    }));
    workspaceIPC('google:status',()=>googleCalendar.status());
    workspaceIPC('google:connect',()=>googleCalendar.connect());
    workspaceIPC('google:disconnect',()=>googleCalendar.disconnect());
    workspaceIPC('google:configure',async()=>{
      const generation = lockGeneration;
      const selected = await dialog.showOpenDialog(win,{title:'Select Google Desktop OAuth client JSON',properties:['openFile'],filters:[{name:'Google OAuth client',extensions:['json']}]});
      assertCurrent(generation);
      if(selected.canceled) return googleCalendar.status();
      const path = selected.filePaths[0]; if(statSync(path).size > 64000) throw new Error('Choose the Google Desktop OAuth client JSON file.');
      let data; try { data = JSON.parse(readFileSync(path,'utf8')); } catch { throw new Error('This is not a valid Google Desktop OAuth client file.'); }
      return googleCalendar.configure(data.installed);
    });
    workspaceIPC('google:sync',value=>{
      if(!value || !Array.isArray(value.ids) || !value.ids.length || value.ids.length > 100) throw new Error('Select calendar entries to sync.');
      const current = server.calendarEntries();
      if(value.caseKey !== current.caseKey) throw new Error('Your case changed. Reopen Calendar.');
      const ids = [...new Set(value.ids)];
      const events = ids.map(id=>{ const event = current.events.find(e=>e.id === id && e.syncable); if(!event) throw new Error('An entry changed or needs review. Refresh Calendar before syncing.'); return {id:event.id,title:event.title,date:event.date,details:event.details || ''}; });
      return googleCalendar.sync({caseKey:current.caseKey,events});
    });
    powerMonitor.on('suspend', lock); powerMonitor.on('lock-screen', lock);
    setInterval(() => { if ((unlocked || setupAuthorized) && Date.now() - lastActivity > 300000) lock(); }, 5000).unref();
    createWindow(); buildMenu(); app.on('activate', () => { if (!win) createWindow(); });
  }).catch((error) => { dialog.showErrorBox('Case Forge could not start', error.message); app.quit(); });
  app.on('before-quit', stopServer);
  app.on('window-all-closed', () => { if (process.platform !== 'darwin' && !installingUpdate) app.quit(); });
}
