const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

const config = require('./config');
const addons = require('./addons');

app.setName('QtAU');

let win;

function send(channel, data) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, data);
}

function createWindow() {
  win = new BrowserWindow({
    width: 840,
    height: 620,
    minWidth: 720,
    minHeight: 480,
    title: 'QtAddonUpdater',
    backgroundColor: '#100e0c',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  config.load();
  createWindow();
});

app.on('window-all-closed', () => app.quit());

ipcMain.handle('config:get', () => config.get());
ipcMain.handle('config:set', (_e, patch) => config.set(patch || {}));

ipcMain.handle('dialog:folder', async () => {
  const result = await dialog.showOpenDialog(win, {
    title: 'Choose AddOns folder',
    properties: ['openDirectory']
  });
  if (result.canceled || !result.filePaths[0]) return null;
  return result.filePaths[0];
});

ipcMain.handle('dialog:file', async () => {
  const result = await dialog.showOpenDialog(win, {
    title: 'Choose launcher / client',
    properties: ['openFile'],
    filters: [{ name: 'Executable', extensions: ['exe'] }]
  });
  if (result.canceled || !result.filePaths[0]) return null;
  return result.filePaths[0];
});

ipcMain.handle('addons:scan', async () => {
  const cfg = config.get();
  return addons.scan(cfg.addonsDir, {
    bindings: cfg.bindings,
    onProgress: (p) => send('addons:progress', p)
  });
});

ipcMain.handle('addons:update', async (_e, opts = {}) => {
  const cfg = config.get();
  return addons.update(cfg.addonsDir, {
    folders: opts.folders,
    force: Boolean(opts.force ?? cfg.forceUpdate),
    bindings: cfg.bindings,
    ignored: cfg.ignored,
    skipIgnored: !opts.folders,
    onProgress: (p) => send('addons:progress', p)
  });
});

ipcMain.handle('addons:install', async (_e, opts = {}) => {
  const cfg = config.get();
  const result = await addons.install(
    cfg.addonsDir,
    opts.url,
    opts.folder,
    (p) => send('addons:progress', p)
  );
  if (result.ok && result.folder) {
    config.set({ bindings: { [result.folder]: result.git } });
  }
  return result;
});

ipcMain.handle('addons:remove', async (_e, folder) => {
  const cfg = config.get();
  const result = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['Delete', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    title: 'Delete addon',
    message: `Delete "${folder}" from the AddOns folder?`,
    detail: 'The folder is removed from disk. This cannot be undone.'
  });
  if (result.response !== 0) return { ok: false, cancelled: true };
  await addons.remove(cfg.addonsDir, folder);
  config.set({ ignored: { [folder]: false } });
  return { ok: true, folder };
});

ipcMain.handle('addons:openFolder', async () => {
  const dir = config.get().addonsDir;
  if (!dir || !fs.existsSync(dir)) {
    throw new Error('AddOns folder is not set or does not exist');
  }
  const err = await shell.openPath(dir);
  if (err) throw new Error(err);
  return { ok: true };
});

ipcMain.handle('launch', async () => {
  const cfg = config.get();
  if (!cfg.launcherPath || !fs.existsSync(cfg.launcherPath)) {
    throw new Error('Launcher path is not set or the file is missing');
  }
  const child = spawn(cfg.launcherPath, [], {
    cwd: path.dirname(cfg.launcherPath),
    detached: true,
    stdio: 'ignore',
    windowsHide: false
  });
  child.unref();
  return { ok: true };
});
