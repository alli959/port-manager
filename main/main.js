const { app, BrowserWindow, ipcMain, nativeTheme } = require('electron');
const path = require('path');
const { scanPorts } = require('./scanner');
const { killProcess } = require('./process-manager');
const { initSettings, getSettings, setSettings } = require('./settings');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 800,
    minHeight: 500,
    title: 'Port Manager',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.setMenu(null);
}

function setupIPC() {
  ipcMain.handle('scan-ports', async () => {
    return scanPorts();
  });

  ipcMain.handle('kill-process', async (_event, request) => {
    return killProcess(request);
  });

  ipcMain.handle('get-platform', () => {
    const { getPlatform } = require('./platform');
    return getPlatform();
  });

  ipcMain.handle('get-settings', async () => {
    return getSettings();
  });

  ipcMain.handle('set-settings', async (_event, partial) => {
    const updated = setSettings(partial);
    mainWindow?.webContents.send('settings-changed', updated);
    return updated;
  });
}

app.whenReady().then(() => {
  initSettings();
  createWindow();
  setupIPC();

  nativeTheme.on('updated', () => {
    const settings = getSettings();
    if (settings.theme === 'system') {
      mainWindow?.webContents.send('settings-changed', settings);
    }
  });
});

app.on('window-all-closed', () => {
  app.quit();
});
