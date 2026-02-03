const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('fileExp', {
  listDirectory: (directoryPath) => ipcRenderer.invoke('list-directory', directoryPath),
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  openFile: (payload) => ipcRenderer.invoke('open-file', payload),
  translateFilename: (filename) => ipcRenderer.invoke('translate-filename', filename),
  getInitialDirectory: () => ipcRenderer.invoke('get-initial-directory')
});
