'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lifevpn', {
  state: () => ipcRenderer.invoke('state'),
  action: (name, ...args) => ipcRenderer.invoke('action', name, ...args),
  onState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('state', listener);
    return () => ipcRenderer.removeListener('state', listener);
  },
  onUI: (callback) => {
    const listener = (_event, message) => callback(message);
    ipcRenderer.on('ui', listener);
    return () => ipcRenderer.removeListener('ui', listener);
  },
  platform: process.platform
});
