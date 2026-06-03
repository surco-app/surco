import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { ProcessProgress } from '../shared/types'

const api = {
  platform: process.platform,
  // Resolved once at startup so the renderer (and the ErrorBoundary above it) can
  // stamp feedback with the version synchronously, like platform.
  version: ipcRenderer.sendSync('app:version') as string,
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (patch: unknown) => ipcRenderer.invoke('settings:set', patch),
  pickFiles: () => ipcRenderer.invoke('dialog:pickFiles'),
  pickOutputDir: () => ipcRenderer.invoke('dialog:pickOutputDir'),
  searchDiscogs: (query: string) => ipcRenderer.invoke('discogs:search', query),
  getRelease: (id: number) => ipcRenderer.invoke('discogs:release', id),
  lookupAppleMusic: (artist: string, title: string): Promise<boolean> =>
    ipcRenderer.invoke('applemusic:lookup', artist, title),
  addToAppleMusic: (job: unknown): Promise<void> => ipcRenderer.invoke('applemusic:add', job),
  processTrack: (job: unknown) => ipcRenderer.invoke('process:track', job),
  exportCover: (job: unknown): Promise<string | null> => ipcRenderer.invoke('cover:export', job),
  prepareCoverDrag: (src: unknown): Promise<string | null> =>
    ipcRenderer.invoke('cover:prepareDrag', src),
  startCoverDrag: (path: string): void => ipcRenderer.send('cover:drag', path),
  reveal: (path: string) => ipcRenderer.invoke('shell:reveal', path),
  spectrogram: (path: string) => ipcRenderer.invoke('audio:spectrogram', path),
  readTags: (path: string) => ipcRenderer.invoke('audio:tags', path),
  readCover: (path: string) => ipcRenderer.invoke('audio:cover', path),
  readAudio: (path: string) => ipcRenderer.invoke('audio:read', path),
  onMenuCommand: (cb: (id: string) => void) => {
    const listener = (_e: unknown, id: string): void => cb(id)
    ipcRenderer.on('menu:command', listener)
    return () => ipcRenderer.removeListener('menu:command', listener)
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
  onUpdateError: (cb: (message: string) => void) => {
    const listener = (_e: unknown, message: string): void => cb(message)
    ipcRenderer.on('update:error', listener)
    return () => ipcRenderer.removeListener('update:error', listener)
  },
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
