import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  ActivityEvent,
  AppleMusicLookupCandidate,
  BpmResult,
  DockIconFrames,
  KeyResult,
  LoudnessResult,
  ProcessProgress,
  SearchHints,
  SearchPriority,
  SearchProviderId,
  SessionData,
  SessionEdit,
  TrackProperties,
  WaveformResult,
} from '../shared/types'
import type { Api } from './api'

const api: Api = {
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
  onFoldersChanged: (cb: (root: string, files: string[]) => void) => {
    const listener = (_e: unknown, root: string, files: string[]): void => cb(root, files)
    ipcRenderer.on('folders:changed', listener)
    return () => ipcRenderer.removeListener('folders:changed', listener)
  },
  unwatchFolders: (): Promise<void> => ipcRenderer.invoke('folders:unwatch'),
  getLastSession: (): Promise<SessionData> => ipcRenderer.invoke('session:get'),
  saveLastSession: (paths: string[], edits: Record<string, SessionEdit>): Promise<void> =>
    ipcRenderer.invoke('session:set', paths, edits),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  recordStat: (key, by) => ipcRenderer.send('stats:record', key, by),
  getConfigDir: (): Promise<string | null> => ipcRenderer.invoke('settings:getConfigDir'),
  defaultConfigDir: (): Promise<string> => ipcRenderer.invoke('settings:defaultConfigDir'),
  setConfigDir: (dir: string | null) => ipcRenderer.invoke('settings:setConfigDir', dir),
  cacheStats: (): Promise<{ files: number; bytes: number }> => ipcRenderer.invoke('cache:stats'),
  clearCache: (): Promise<void> => ipcRenderer.invoke('cache:clear'),
  pickConfigDir: (): Promise<string | null> => ipcRenderer.invoke('dialog:pickConfigDir'),
  pickFiles: () => ipcRenderer.invoke('dialog:pickFiles'),
  pickOutputDir: () => ipcRenderer.invoke('dialog:pickOutputDir'),
  pickEngineLibraryDir: () => ipcRenderer.invoke('dialog:pickEngineLibraryDir'),
  exportRekordbox: (xml: string): Promise<string | null> =>
    ipcRenderer.invoke('dialog:exportRekordbox', xml),
  exportTraktor: (nml: string): Promise<string | null> =>
    ipcRenderer.invoke('dialog:exportTraktor', nml),
  exportSerato: (tracks: { inputPath: string; outputPath?: string }[]): Promise<string | null> =>
    ipcRenderer.invoke('dialog:exportSerato', tracks),
  exportM3u: (m3u: string): Promise<string | null> => ipcRenderer.invoke('dialog:exportM3u', m3u),
  exportQualityReport: (dataUrl: string, baseName: string): Promise<string | null> =>
    ipcRenderer.invoke('dialog:exportQualityReport', dataUrl, baseName),
  exportStatsImage: (dataUrl: string): Promise<string | null> =>
    ipcRenderer.invoke('dialog:exportStatsImage', dataUrl),
  search: (
    query: string,
    provider?: SearchProviderId,
    priority?: SearchPriority,
    hints?: SearchHints,
  ) => ipcRenderer.invoke('search:query', query, provider, priority, hints),
  getRelease: (ref: number | string, provider?: SearchProviderId, priority?: SearchPriority) =>
    ipcRenderer.invoke('search:release', ref, provider, priority),
  loadAppleMusicLibrary: (): Promise<AppleMusicLookupCandidate[]> =>
    ipcRenderer.invoke('applemusic:library'),
  loadEngineLibrary: (): Promise<AppleMusicLookupCandidate[]> =>
    ipcRenderer.invoke('engine:library'),
  addToAppleMusic: (job) => ipcRenderer.invoke('applemusic:add', job),
  updateAppleMusic: (job) => ipcRenderer.invoke('applemusic:update', job),
  revealAppleMusic: (persistentId: string) => ipcRenderer.invoke('applemusic:reveal', persistentId),
  deleteAppleMusic: (persistentId: string, track: string) =>
    ipcRenderer.invoke('applemusic:delete', persistentId, track),
  processTrack: (job) => ipcRenderer.invoke('process:track', job),
  exportCover: (job) => ipcRenderer.invoke('cover:export', job),
  prepareCoverDrag: (src) => ipcRenderer.invoke('cover:prepareDrag', src),
  copyCoverImage: (src) => ipcRenderer.invoke('cover:copyImage', src),
  pasteCoverImage: () => ipcRenderer.invoke('cover:pasteImage'),
  resolveDraggedCover: (urls) => ipcRenderer.invoke('cover:resolveDragged', urls),
  hasClipboardImage: () => ipcRenderer.invoke('clipboard:hasImage'),
  startCoverDrag: (path: string): void => ipcRenderer.send('cover:drag', path),
  startTrackDrag: (paths: string[], coverUrl?: string): void =>
    ipcRenderer.send('track:drag', { paths, coverUrl }),
  reveal: (path: string) => ipcRenderer.invoke('shell:reveal', path),
  openFile: (path: string): Promise<string> => ipcRenderer.invoke('shell:open', path),
  trashFile: (path: string): Promise<void> => ipcRenderer.invoke('shell:trash', path),
  copyText: (text: string): Promise<void> => ipcRenderer.invoke('clipboard:write', text),
  spectrogram: (path: string, priority: 'high' | 'low' = 'low') =>
    ipcRenderer.invoke('audio:spectrogram', path, priority),
  loudness: (path: string): Promise<LoudnessResult | null> =>
    ipcRenderer.invoke('audio:loudness', path),
  properties: (path: string): Promise<TrackProperties | null> =>
    ipcRenderer.invoke('audio:properties', path),
  bpm: (path: string): Promise<BpmResult | null> => ipcRenderer.invoke('audio:bpm', path),
  key: (path: string): Promise<KeyResult | null> => ipcRenderer.invoke('audio:key', path),
  waveform: (path: string): Promise<WaveformResult | null> =>
    ipcRenderer.invoke('audio:waveform', path),
  readTags: (path: string) => ipcRenderer.invoke('audio:tags', path),
  readDuration: (path: string) => ipcRenderer.invoke('audio:duration', path),
  readMeta: (path: string) => ipcRenderer.invoke('audio:meta', path),
  readCover: (path: string) => ipcRenderer.invoke('audio:cover', path),
  readCoverFull: (path: string) => ipcRenderer.invoke('audio:coverFull', path),
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
  onActivity: (cb: (event: ActivityEvent) => void) => {
    const listener = (_e: unknown, event: ActivityEvent): void => cb(event)
    ipcRenderer.on('activity:event', listener)
    return () => ipcRenderer.removeListener('activity:event', listener)
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
  setDockFrames: (frames: DockIconFrames): void => ipcRenderer.send('dock:frames', frames),
  setDockPlaying: (playing: boolean): void => ipcRenderer.send('dock:playing', playing),
}

contextBridge.exposeInMainWorld('api', api)
