const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('portManager', {
  scanPorts: () => ipcRenderer.invoke('scan-ports'),
  killProcess: (request) => ipcRenderer.invoke('kill-process', request),
  getPlatform: () => ipcRenderer.invoke('get-platform'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSettings: (partial) => ipcRenderer.invoke('set-settings', partial),
  onSettingsChanged: (callback) => {
    ipcRenderer.on('settings-changed', (_event, settings) => callback(settings));
  }
});
