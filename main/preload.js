const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('portManager', {
  scanPorts: () => ipcRenderer.invoke('scan-ports'),
  killProcess: (pid, source) => ipcRenderer.invoke('kill-process', { pid, source }),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSettings: (partial) => ipcRenderer.invoke('set-settings', partial),
  onSettingsChanged: (callback) => {
    ipcRenderer.on('settings-changed', (_event, settings) => callback(settings));
  }
});
