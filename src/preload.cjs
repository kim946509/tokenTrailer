const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('trailer', {
  snapshot: filter => ipcRenderer.invoke('snapshot', filter),
  save: settings => ipcRenderer.invoke('save-settings', settings),
  refresh: () => ipcRenderer.invoke('refresh'),
  history: (action, provider) => ipcRenderer.invoke('history', action, provider),
  session: key => ipcRenderer.invoke('session', key),
  open: () => ipcRenderer.invoke('open-dashboard'),
  quit: () => ipcRenderer.invoke('quit'),
  changed: callback => { const listener = () => callback(); ipcRenderer.on('changed', listener); return () => ipcRenderer.removeListener('changed', listener); },
});
