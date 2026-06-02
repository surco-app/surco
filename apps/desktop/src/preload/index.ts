import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { ProcessProgress } from '../shared/types'

const api = {
  platform: process.platform,
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
  readTags: (path: string) => ipcRenderer.invoke('audio:tags', path),
  readCover: (path: string) => ipcRenderer.invoke('audio:cover', path),
  readAudio: (path: string) => ipcRenderer.invoke('audio:read', path),
  onOpenSettings: (cb: () => void) => {
    const listener = (): void => cb()
    ipcRenderer.on('menu:settings', listener)
    return () => ipcRenderer.removeListener('menu:settings', listener)
  },
  onProcessProgress: (cb: (progress: ProcessProgress) => void) => {
    const listener = (_e: unknown, progress: ProcessProgress): void => cb(progress)
    ipcRenderer.on('process:progress', listener)
    return () => ipcRenderer.removeListener('process:progress', listener)
  },
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateDownloaded: (cb: (version: string) => void) => {
    const listener = (_e: unknown, version: string): void => cb(version)
    ipcRenderer.on('update:downloaded', listener)
    return () => ipcRenderer.removeListener('update:downloaded', listener)
  },
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
