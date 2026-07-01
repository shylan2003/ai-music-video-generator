import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  openFile: (options: Electron.OpenDialogOptions) =>
    ipcRenderer.invoke('dialog:openFile', options),
  readTextFile: (filePath: string) =>
    ipcRenderer.invoke('file:readText', filePath),
  writeTextFile: (filePath: string, content: string) =>
    ipcRenderer.invoke('file:writeText', filePath, content),
  fileExists: (filePath: string) => ipcRenderer.invoke('file:exists', filePath),
  fileToUrl: (filePath: string) => ipcRenderer.invoke('file:toUrl', filePath),
  getBackendConfig: () => ipcRenderer.invoke('backend:config'),
  loadModelSettings: () =>
    ipcRenderer.invoke('settings:load'),
  saveModelSettings: (payload: unknown) =>
    ipcRenderer.invoke('settings:save', payload),
  saveFile: (options: Electron.SaveDialogOptions) =>
    ipcRenderer.invoke('dialog:saveFile', options),
  exportVideo: (payload: unknown) => ipcRenderer.invoke('video:export', payload),
  onExportProgress: (callback: (payload: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload)
    ipcRenderer.on('video:exportProgress', listener)
    return () => ipcRenderer.removeListener('video:exportProgress', listener)
  },
  platform: process.platform,
})
