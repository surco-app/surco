import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { LoudnessResult, ProcessProgress, SearchProviderId } from '../shared/types'

const api = {
  platform: process.platform,
  // Resolved once at startup so the renderer (and the ErrorBoundary above it) can
  // stamp feedback with the version synchronously, like platform.
  version: ipcRenderer.sendSync('app:version') as string,
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  expandPaths: (paths: string[]): Promise<string[]> => ipcRenderer.invoke('files:expand', paths),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (patch: unknown) => ipcRenderer.invoke('settings:set', patch),
  pickFiles: () => ipcRenderer.invoke('dialog:pickFiles'),
  pickOutputDir: () => ipcRenderer.invoke('dialog:pickOutputDir'),
  searchDiscogs: (query: string, provider?: SearchProviderId) =>
    ipcRenderer.invoke('search:query', query, provider),
  getRelease: (id: number, provider?: SearchProviderId) =>
    ipcRenderer.invoke('search:release', id, provider),
  lookupAppleMusic: (artist: string, title: string): Promise<boolean> =>
    ipcRenderer.invoke('applemusic:lookup', artist, title),
  addToAppleMusic: (job: unknown): Promise<void> => ipcRenderer.invoke('applemusic:add', job),
  processTrack: (job: unknown) => ipcRenderer.invoke('process:track', job),
  exportCover: (job: unknown): Promise<string | null> => ipcRenderer.invoke('cover:export', job),
  prepareCoverDrag: (src: unknown): Promise<string | null> =>
    ipcRenderer.invoke('cover:prepareDrag', src),
  startCoverDrag: (path: string): void => ipcRenderer.send('cover:drag', path),
  reveal: (path: string) => ipcRenderer.invoke('shell:reveal', path),
  openFile: (path: string): Promise<string> => ipcRenderer.invoke('shell:open', path),
  trashFile: (path: string): Promise<void> => ipcRenderer.invoke('shell:trash', path),
  copyText: (text: string): Promise<void> => ipcRenderer.invoke('clipboard:write', text),
  spectrogram: (path: string) => ipcRenderer.invoke('audio:spectrogram', path),
  loudness: (path: string): Promise<LoudnessResult | null> =>
    ipcRenderer.invoke('audio:loudness', path),
  readTags: (path: string) => ipcRenderer.invoke('audio:tags', path),
  readDuration: (path: string) => ipcRenderer.invoke('audio:duration', path),
  readCover: (path: string) => ipcRenderer.invoke('audio:cover', path),
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
