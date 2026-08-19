const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('qtau', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (patch) => ipcRenderer.invoke('config:set', patch),
  pickFolder: () => ipcRenderer.invoke('dialog:folder'),
  pickFile: () => ipcRenderer.invoke('dialog:file'),
  scan: () => ipcRenderer.invoke('addons:scan'),
  update: (opts) => ipcRenderer.invoke('addons:update', opts),
  install: (opts) => ipcRenderer.invoke('addons:install', opts),
  launch: () => ipcRenderer.invoke('launch'),
  onProgress: (cb) => {
    const listener = (_event, data) => cb(data);
    ipcRenderer.on('addons:progress', listener);
    return () => ipcRenderer.removeListener('addons:progress', listener);
  }
});
