const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require("electron");
const { join } = require("node:path");
const { pathToFileURL } = require("node:url");
const { readFileSync, writeFileSync, existsSync, mkdirSync, cpSync, realpathSync } = require("node:fs");

// Locate the bundled app + sample case in both dev and packaged builds.
const base = app.isPackaged ? process.resourcesPath : join(__dirname, "..");
const serverPath = join(base, "app", "server.js");
const sampleCase = join(base, "sample-case");

const cfgPath = join(app.getPath("userData"), "config.json");
function loadVault() {
  try {
    const v = JSON.parse(readFileSync(cfgPath, "utf8")).vault;
    return v && existsSync(v) ? v : null;
  } catch {
    return null;
  }
}
function saveVault(v) {
  try { writeFileSync(cfgPath, JSON.stringify({ vault: v })); } catch { /* non-fatal */ }
}

let currentVault = loadVault() || sampleCase;
let win = null;
let serverPort = null;

function liveWindow() {
  return win && !win.isDestroyed() ? win : null;
}

async function pickFolder(reloadWindow = true) {
  const parent = liveWindow();
  const options = {
    title: "Choose your case vault folder",
    message: "Pick the folder that holds your case vault.",
    properties: ["openDirectory", "createDirectory"],
  };
  const r = parent
    ? await dialog.showOpenDialog(parent, options)
    : await dialog.showOpenDialog(options);
  if (!r.canceled && r.filePaths[0]) {
    currentVault = r.filePaths[0];
    saveVault(currentVault);
    if (reloadWindow) liveWindow()?.reload();
    return true;
  }
  return false;
}

function useSample() {
  currentVault = sampleCase;
  saveVault(currentVault);
  liveWindow()?.reload();
}

function createWindow() {
  const browserWindow = new BrowserWindow({
    width: 1240,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    title: "Case Forge",
    backgroundColor: "#F8F4EC",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(__dirname, "preload.cjs"),
    },
  });

  win = browserWindow;
  browserWindow.on("closed", () => {
    if (win === browserWindow) win = null;
  });

  const appOrigin = `http://127.0.0.1:${serverPort}`;
  browserWindow.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin !== appOrigin) event.preventDefault();
  });
  browserWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url === "https://github.com/CaseForgeHq/family-court-strategist") shell.openExternal(url);
    return { action: "deny" };
  });

  browserWindow.loadURL(`http://127.0.0.1:${serverPort}`);
}

function buildMenu() {
  const isMac = process.platform === "darwin";
  const template = [
    ...(isMac ? [{ role: "appMenu" }] : []),
    {
      label: "File",
      submenu: [
        { label: "Open Case Folder…", accelerator: "CmdOrCtrl+O", click: pickFolder },
        { label: "Load Sample Case", click: useSample },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" }, { role: "forceReload" }, { type: "separator" },
        { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" },
        { role: "togglefullscreen" }, { role: "toggleDevTools" },
      ],
    },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        { label: "Project on GitHub", click: () => shell.openExternal("https://github.com/CaseForgeHq/family-court-strategist") },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(async () => {
  mkdirSync(app.getPath("userData"), { recursive: true });
  // Development gets a writable copy, never the bundled sample itself.
  if (!app.isPackaged && currentVault === sampleCase) {
    const preview = join(app.getPath("userData"), "preview-case");
    if (!existsSync(preview)) cpSync(sampleCase, preview, { recursive: true });
    currentVault = preview;
  }
  const { createServer } = await import(pathToFileURL(serverPath).href);
  const server = createServer(() => currentVault, {
    // Packaged builds fail closed until a real billing entitlement is integrated.
    enableClaudeCode: !app.isPackaged && process.env.STRATEGIST_CLAUDE_CODE_PREVIEW === "1",
    getAccess: (root) => {
      const canWrite = !app.isPackaged && root !== realpathSync(sampleCase);
      return { canWrite, mode: canWrite ? "development" : "read-only",
        message: canWrite ? "Development preview · billing is not connected" : "Read-only · subscription activation is not available in this build" };
    },
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  serverPort = server.address().port;
  app.on("before-quit", () => { server.inbox.close(); server.close(); });

  ipcMain.handle("vault:choose-folder", (event) => {
    const currentWindow = liveWindow();
    if (
      !currentWindow
      || event.sender !== currentWindow.webContents
      || event.senderFrame !== currentWindow.webContents.mainFrame
    ) return false;
    return pickFolder(false);
  });

  createWindow();
  buildMenu();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
