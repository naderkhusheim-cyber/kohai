const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('kohai', {
  onEvent:   (cb) => ipcRenderer.on('kohai:event',   (_, p) => cb(p)),
  onControl: (cb) => ipcRenderer.on('kohai:control', (_, p) => cb(p)),
  onResize:  (cb) => ipcRenderer.on('kohai:resize',  (_, p) => cb(p)),
});
