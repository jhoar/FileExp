const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('fileExp', {
  listDirectory: (directoryPath) => ipcRenderer.invoke('list-directory', directoryPath),
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  selectTranslationDb: () => ipcRenderer.invoke('select-translation-db'),
  loadTranslationDb: (filePath) => ipcRenderer.invoke('load-translation-db', filePath),
  getTranslation: (filePath) => ipcRenderer.invoke('get-translation', filePath),
  openFile: (payload) => ipcRenderer.invoke('open-file', payload),
  getInitialDirectory: () => ipcRenderer.invoke('get-initial-directory')
});
