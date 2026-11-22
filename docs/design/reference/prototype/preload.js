const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('gw', {
  onFrame: fn => ipcRenderer.on('frame', (_e, frame) => fn(frame)),
  submit: text => ipcRenderer.invoke('submit', text),
  approve: answer => ipcRenderer.invoke('approve', answer)
})
