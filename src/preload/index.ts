import { contextBridge, ipcRenderer, webUtils } from 'electron'

const api = {
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (patch: unknown) => ipcRenderer.invoke('settings:set', patch),
  pickFiles: () => ipcRenderer.invoke('dialog:pickFiles'),
  pickOutputDir: () => ipcRenderer.invoke('dialog:pickOutputDir'),
  searchDiscogs: (query: string) => ipcRenderer.invoke('discogs:search', query),
  getRelease: (id: number) => ipcRenderer.invoke('discogs:release', id),
  processTrack: (job: unknown) => ipcRenderer.invoke('process:track', job),
  reveal: (path: string) => ipcRenderer.invoke('shell:reveal', path),
  spectrogram: (path: string) => ipcRenderer.invoke('audio:spectrogram', path),
  onOpenSettings: (cb: () => void) => {
    const listener = (): void => cb()
    ipcRenderer.on('menu:settings', listener)
    return () => ipcRenderer.removeListener('menu:settings', listener)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
