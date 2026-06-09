import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { LicenseActionResult, LicenseSnapshot } from '../shared/license'
import type {
  LoudnessResult,
  ProcessProgress,
  SearchPriority,
  SearchProviderId,
  TrackProperties,
} from '../shared/types'

const api = {
  platform: process.platform,
  // Resolved once at startup so the renderer (and the ErrorBoundary above it) can
  // stamp feedback with the version synchronously, like platform.
  version: ipcRenderer.sendSync('app:version') as string,
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  expandPaths: (paths: string[]): Promise<string[]> => ipcRenderer.invoke('files:expand', paths),
  takePendingFiles: (): Promise<string[]> => ipcRenderer.invoke('files:pending'),
  onOpenFiles: (cb: (paths: string[]) => void) => {
    const listener = (_e: unknown, paths: string[]): void => cb(paths)
    ipcRenderer.on('open-files', listener)
    return () => ipcRenderer.removeListener('open-files', listener)
  },
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (patch: unknown) => ipcRenderer.invoke('settings:set', patch),
  licenseStatus: (): Promise<LicenseSnapshot> => ipcRenderer.invoke('license:status'),
  activateLicense: (key: string, email: string): Promise<LicenseActionResult> =>
    ipcRenderer.invoke('license:activate', key, email),
  validateLicense: (): Promise<LicenseActionResult> => ipcRenderer.invoke('license:validate'),
  deactivateLicense: (): Promise<LicenseActionResult> => ipcRenderer.invoke('license:deactivate'),
  buyLicense: (): Promise<void> => ipcRenderer.invoke('license:buy'),
  pickFiles: () => ipcRenderer.invoke('dialog:pickFiles'),
  pickOutputDir: () => ipcRenderer.invoke('dialog:pickOutputDir'),
  exportRekordbox: (xml: string): Promise<string | null> =>
    ipcRenderer.invoke('dialog:exportRekordbox', xml),
  exportTraktor: (nml: string): Promise<string | null> =>
    ipcRenderer.invoke('dialog:exportTraktor', nml),
  searchDiscogs: (query: string, provider?: SearchProviderId, priority?: SearchPriority) =>
    ipcRenderer.invoke('search:query', query, provider, priority),
  getRelease: (id: number, provider?: SearchProviderId, priority?: SearchPriority) =>
    ipcRenderer.invoke('search:release', id, provider, priority),
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
  properties: (path: string): Promise<TrackProperties | null> =>
    ipcRenderer.invoke('audio:properties', path),
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
  onWindowFocus: (cb: (focused: boolean) => void) => {
    const listener = (_e: unknown, focused: boolean): void => cb(focused)
    ipcRenderer.on('window:focus', listener)
    return () => ipcRenderer.removeListener('window:focus', listener)
  },
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
