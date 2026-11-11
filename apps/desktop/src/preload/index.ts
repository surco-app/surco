import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { AudioAnalysisIpc, PeekableAnalyses } from '../shared/audioIpcContract'
import type { CueProfile, CueProfileRead, TasteTrack } from '../shared/cueProfile'
import type {
  ActivityEvent,
  AppleMusicLookupCandidate,
  AppleMusicPlaylist,
  AppleMusicPlaylistTracks,
  AppleMusicTrackMeta,
  BpmResult,
  DjProgram,
  DockIconFrames,
  KeyResult,
  LimiterGlimpse,
  ListFixRequest,
  ListRemoval,
  LoudnessResult,
  MusicFieldFix,
  MusicFileLookup,
  MusicFixProgress,
  MusicReviewEntry,
  PairFacts,
  ProcessProgress,
  ProgramCopies,
  RememberedAutoMatch,
  RestoreResult,
  ReviewWriteField,
  RowWaveRequest,
  ScanVerdict,
  SearchHints,
  SearchPriority,
  SearchProviderId,
  SessionData,
  SessionEdit,
  SpectrumVerdict,
  TrackProperties,
  TrashEntry,
  UsbExportEvent,
  UsbExportRequest,
  UsbFolderPick,
  UsbPlanResult,
  UsbStartResult,
  UsbVolumeList,
  WaveformResult,
  WaveformScan,
  WritableProgram,
} from '../shared/types'
import type { Verification } from '../shared/verification'
import type { Api } from './api'
import { createCuesApi } from './cues'
import { createDjApi } from './dj'

// The renderer half of shared/audioIpcContract.ts: every analysis invoke goes
// through here, so its channel name, arguments and promised result stay welded
// to what the main handler was compiled against.
const invokeAudio = <K extends keyof AudioAnalysisIpc>(
  channel: K,
  ...args: AudioAnalysisIpc[K]['args']
): Promise<AudioAnalysisIpc[K]['result']> => ipcRenderer.invoke(channel, ...args)

const api: Api = {
  platform:
    (process.env.SURCO_SIMULATE_PLATFORM as NodeJS.Platform | undefined) ?? process.platform,
  storeBuild: process.windowsStore === true,
  // Resolved once at startup so the renderer (and the ErrorBoundary above it) can
  // stamp feedback with the version synchronously, like platform.
  version: ipcRenderer.sendSync('app:version') as string,
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  expandPaths: (paths: string[], reportNotAudio?: boolean): Promise<string[]> =>
    ipcRenderer.invoke('files:expand', paths, reportNotAudio),
  takePendingFiles: (): Promise<string[]> => ipcRenderer.invoke('files:pending'),
  onExpandedBatch: (cb: (paths: string[]) => void) => {
    const listener = (_e: unknown, paths: string[]): void => cb(paths)
    ipcRenderer.on('files:expanded', listener)
    return () => ipcRenderer.removeListener('files:expanded', listener)
  },
  onNotAudioSkipped: (cb: (count: number) => void) => {
    const listener = (_e: unknown, count: number): void => cb(count)
    ipcRenderer.on('files:notAudio', listener)
    return () => ipcRenderer.removeListener('files:notAudio', listener)
  },
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
  saveLastSession: (
    paths: string[],
    edits: Record<string, SessionEdit>,
    view?: unknown,
  ): Promise<void> => ipcRenderer.invoke('session:set', paths, edits, view),
  saveLastSessionSync: (
    paths: string[],
    edits: Record<string, SessionEdit>,
    view?: unknown,
  ): void => {
    ipcRenderer.sendSync('session:set-sync', paths, edits, view)
  },
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  beatportConnect: (username, password) =>
    ipcRenderer.invoke('beatport:connect', username, password),
  beatportDisconnect: () => ipcRenderer.invoke('beatport:disconnect'),
  recordStat: (key, by) => ipcRenderer.send('stats:record', key, by),
  getConfigDir: (): Promise<string | null> => ipcRenderer.invoke('settings:getConfigDir'),
  defaultConfigDir: (): Promise<string> => ipcRenderer.invoke('settings:defaultConfigDir'),
  setConfigDir: (dir: string | null) => ipcRenderer.invoke('settings:setConfigDir', dir),
  configDirHasSettings: (dir: string): Promise<boolean> =>
    ipcRenderer.invoke('settings:configDirHasSettings', dir),
  cacheStats: (): Promise<{ files: number; bytes: number }> => ipcRenderer.invoke('cache:stats'),
  clearCache: (): Promise<void> => ipcRenderer.invoke('cache:clear'),
  pickConfigDir: (): Promise<string | null> => ipcRenderer.invoke('dialog:pickConfigDir'),
  pickFiles: () => ipcRenderer.invoke('dialog:pickFiles'),
  pickOutputDir: () => ipcRenderer.invoke('dialog:pickOutputDir'),
  detectTraktorNmlPath: () => ipcRenderer.invoke('traktor:detectNmlPath'),
  traktorCollectionInUse: (path: string): Promise<string | null> =>
    ipcRenderer.invoke('traktor:collectionInUse', path),
  rekordboxCollection: () => ipcRenderer.invoke('rekordbox:collection'),
  appleMusicEntryLocation: (persistentId: string): Promise<string> =>
    ipcRenderer.invoke('applemusic:entryLocation', persistentId),
  appleMusicEntryMeta: (
    path: string,
    persistentIds: string[],
  ): Promise<AppleMusicTrackMeta | null> =>
    ipcRenderer.invoke('applemusic:entryMeta', path, persistentIds),
  exportM3u: (m3u: string): Promise<string | null> => ipcRenderer.invoke('dialog:exportM3u', m3u),
  exportSettings: (): Promise<string | null> => ipcRenderer.invoke('dialog:exportSettings'),
  importSettings: () => ipcRenderer.invoke('dialog:importSettings'),
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
  appleMusicFileEntries: (candidates, launch): Promise<MusicFileLookup> =>
    ipcRenderer.invoke('applemusic:fileEntries', candidates, launch),
  loadMusicReview: (): Promise<MusicReviewEntry[]> => ipcRenderer.invoke('applemusic:reviewDump'),
  applyMusicFixes: (fixes: MusicFieldFix[]) => ipcRenderer.invoke('applemusic:applyFixes', fixes),
  cancelMusicFixes: () => ipcRenderer.invoke('applemusic:cancelFixes'),
  syncLibraryTags: (updates) => ipcRenderer.invoke('library:syncTags', updates),
  replaceDuplicatesInLibraries: (pairs) => ipcRenderer.invoke('library:replaceDuplicates', pairs),
  libraryStatus: () => ipcRenderer.invoke('library:status'),
  libraryCopyInfo: (paths) => ipcRenderer.invoke('library:copyInfo', paths),
  scanDamage: (paths) => ipcRenderer.invoke('damage:scan', paths),
  repairDamage: (items) => ipcRenderer.invoke('damage:repair', items),
  setMusicField: (
    pid: string,
    field: ReviewWriteField,
    from: string,
    to: string,
    location?: string,
  ) => ipcRenderer.invoke('applemusic:setField', pid, field, from, to, location),
  removeMusicDuplicate: (req) => ipcRenderer.invoke('applemusic:removeDuplicate', req),
  onMusicFixProgress: (cb: (p: MusicFixProgress) => void) => {
    const listener = (_e: unknown, p: MusicFixProgress): void => cb(p)
    ipcRenderer.on('applemusic:fixProgress', listener)
    return () => ipcRenderer.removeListener('applemusic:fixProgress', listener)
  },
  applyListFixes: (req: ListFixRequest) => ipcRenderer.invoke('listreview:applyFixes', req),
  cancelListFixes: () => ipcRenderer.invoke('listreview:cancelFixes'),
  onListFixProgress: (cb: (p: MusicFixProgress) => void) => {
    const listener = (_e: unknown, p: MusicFixProgress): void => cb(p)
    ipcRenderer.on('listreview:fixProgress', listener)
    return () => ipcRenderer.removeListener('listreview:fixProgress', listener)
  },
  removeListDuplicates: (removals: ListRemoval[]) =>
    ipcRenderer.invoke('listreview:removeDuplicates', removals),
  onListRemovalPhase: (cb: (phase: 'checking-music') => void) => {
    const listener = (_e: unknown, phase: 'checking-music'): void => cb(phase)
    ipcRenderer.on('listreview:removalPhase', listener)
    return () => ipcRenderer.removeListener('listreview:removalPhase', listener)
  },
  loadAppleMusicLibraryCached: (): Promise<AppleMusicLookupCandidate[] | null> =>
    ipcRenderer.invoke('applemusic:libraryCached'),
  loadAppleMusicPlaylists: (): Promise<AppleMusicPlaylist[]> =>
    ipcRenderer.invoke('applemusic:playlists'),
  loadAppleMusicPlaylistTracks: (
    persistentId: string,
    from?: number,
    to?: number,
  ): Promise<AppleMusicPlaylistTracks> =>
    ipcRenderer.invoke('applemusic:playlistTracks', persistentId, from, to),
  loadAppleMusicLibraryPlaylistTracks: (
    persistentId: string,
  ): Promise<AppleMusicPlaylistTracks | null> =>
    ipcRenderer.invoke('applemusic:libraryPlaylistTracks', persistentId),
  loadAppleMusicPlaylistsCached: (): Promise<AppleMusicPlaylist[] | null> =>
    ipcRenderer.invoke('applemusic:playlistsCached'),
  loadAppleMusicPlaylistCached: (persistentId: string): Promise<AppleMusicPlaylistTracks | null> =>
    ipcRenderer.invoke('applemusic:playlistCached', persistentId),
  appleMusicArtwork: (
    persistentIds: string[],
  ): Promise<Record<string, { coverPath: string; coverUrl: string }>> =>
    ipcRenderer.invoke('applemusic:artwork', persistentIds),
  dj: createDjApi(ipcRenderer),
  cues: createCuesApi(ipcRenderer),
  djAppRunning: (): Promise<boolean> => ipcRenderer.invoke('djApps:running'),
  holdsInLibrary: (path: string, titles: string[]): Promise<boolean> =>
    ipcRenderer.invoke('library:holdsFile', path, titles),
  rowWaves: (requests: RowWaveRequest[]): Promise<Record<string, number[]>> =>
    ipcRenderer.invoke('list:rowWaves', requests),
  rekordboxCountCompletable: (): Promise<number> =>
    ipcRenderer.invoke('rekordbox:countCompletable'),
  cueProfile: (): Promise<CueProfileRead> => ipcRenderer.invoke('cues:profile'),
  learnCueProfile: (): Promise<CueProfile> => ipcRenderer.invoke('cues:learn'),
  recordCueEdit: (track: TasteTrack): Promise<void> => ipcRenderer.invoke('cues:recordEdit', track),
  onCueProfileChanged: (cb: () => void) => {
    const listener = (): void => cb()
    ipcRenderer.on('cues:profileChanged', listener)
    return () => ipcRenderer.removeListener('cues:profileChanged', listener)
  },
  traktorCanSave: (): Promise<boolean> => ipcRenderer.invoke('traktor:canSave'),
  usbVolumes: (): Promise<UsbVolumeList> => ipcRenderer.invoke('usb:volumes'),
  onUsbVolumesChanged: (cb: (list: UsbVolumeList) => void) => {
    const listener = (_e: unknown, list: UsbVolumeList): void => cb(list)
    ipcRenderer.on('usb:volumesChanged', listener)
    return () => ipcRenderer.removeListener('usb:volumesChanged', listener)
  },
  usbPickFolder: (source?: Exclude<DjProgram, 'rekordbox'>): Promise<UsbFolderPick | null> =>
    ipcRenderer.invoke('usb:pickFolder', source),
  usbPlan: (req: UsbExportRequest): Promise<UsbPlanResult> => ipcRenderer.invoke('usb:plan', req),
  usbExport: (req: UsbExportRequest): Promise<UsbStartResult> =>
    ipcRenderer.invoke('usb:export', req),
  usbCancel: (): Promise<boolean> => ipcRenderer.invoke('usb:cancel'),
  onUsbEvent: (cb: (e: UsbExportEvent) => void) => {
    const listener = (_e: unknown, event: UsbExportEvent): void => cb(event)
    ipcRenderer.on('usb:event', listener)
    return () => ipcRenderer.removeListener('usb:event', listener)
  },
  loadEngineLibrary: (): Promise<AppleMusicLookupCandidate[]> =>
    ipcRenderer.invoke('engine:library'),
  addToAppleMusic: (job) => ipcRenderer.invoke('applemusic:add', job),
  updateAppleMusic: (job) => ipcRenderer.invoke('applemusic:update', job),
  revealAppleMusic: (persistentId: string) => ipcRenderer.invoke('applemusic:reveal', persistentId),
  deleteAppleMusic: (persistentId: string, track: string) =>
    ipcRenderer.invoke('applemusic:delete', persistentId, track),
  processTrack: (job) => ipcRenderer.invoke('process:track', job),
  onVerifyUpdate: (cb) => {
    const listener = (_e: unknown, trackId: string, v: Verification): void => cb(trackId, v)
    ipcRenderer.on('verify:update', listener)
    return () => ipcRenderer.removeListener('verify:update', listener)
  },
  retryVerification: (trackId) => ipcRenderer.invoke('verify:retry', trackId),
  verifyMusicAdded: (trackId, persistentId) =>
    ipcRenderer.invoke('verify:musicAdded', trackId, persistentId),
  releasePlayingFile: (path) => ipcRenderer.invoke('player:release', path),
  beginConversionBatch: (): void => ipcRenderer.send('process:batch-begin'),
  endConversionBatch: (): void => ipcRenderer.send('process:batch-end'),
  cancelJob: (jobId: string): void => ipcRenderer.send('process:cancel', jobId),
  reportUnsavedCues: (contentIds: string[]): void => ipcRenderer.send('cues:unsaved', contentIds),
  exportCover: (job) => ipcRenderer.invoke('cover:export', job),
  prepareCoverDrag: (src) => ipcRenderer.invoke('cover:prepareDrag', src),
  copyCoverImage: (src) => ipcRenderer.invoke('cover:copyImage', src),
  pasteCoverImage: () => ipcRenderer.invoke('cover:pasteImage'),
  resolveDraggedCover: (urls) => ipcRenderer.invoke('cover:resolveDragged', urls),
  hasClipboardImage: () => ipcRenderer.invoke('clipboard:hasImage'),
  startCoverDrag: (path: string): void => ipcRenderer.send('cover:drag', path),
  startTrackDrag: (paths: string[], coverUrl?: string): void =>
    ipcRenderer.send('track:drag', { paths, coverUrl }),
  pathAliases: (paths: string[]): Promise<string[]> =>
    ipcRenderer.invoke('library:pathAliases', paths),
  reveal: (path: string) => ipcRenderer.invoke('shell:reveal', path),
  openFile: (path: string): Promise<string> => ipcRenderer.invoke('shell:open', path),
  trashFile: (path: string, permanentConfirmed: boolean): Promise<void> =>
    ipcRenderer.invoke('shell:trash', path, permanentConfirmed),
  keepsTrash: (path: string): Promise<boolean> => ipcRenderer.invoke('shell:keepsTrash', path),
  retireSuperseded: (path: string, titles: string[]): Promise<'retired' | 'used'> =>
    ipcRenderer.invoke('shell:retireSuperseded', path, titles),
  trashList: (): Promise<TrashEntry[]> => ipcRenderer.invoke('trash:list'),
  trashRestore: (id: string, from?: 'undo'): Promise<{ restoredTo: string }> =>
    ipcRenderer.invoke('trash:restore', id, from),
  trashRemove: (id: string): Promise<void> => ipcRenderer.invoke('trash:remove', id),
  trashEmpty: (): Promise<void> => ipcRenderer.invoke('trash:empty'),
  trashReveal: (): Promise<void> => ipcRenderer.invoke('trash:reveal'),
  copyText: (text: string): Promise<void> => ipcRenderer.invoke('clipboard:write', text),
  logInfo: (message: string): void => ipcRenderer.send('log:info', message),
  logError: (message: string, stack?: string): void =>
    ipcRenderer.send('log:renderer', message, stack),
  revealLog: (): Promise<void> => ipcRenderer.invoke('log:reveal'),
  revealBackups: (): Promise<string> => ipcRenderer.invoke('backups:reveal'),
  copiesStatus: (): Promise<ProgramCopies[]> => ipcRenderer.invoke('copies:status'),
  restoreCopy: (program: WritableProgram, copyId: string): Promise<RestoreResult> =>
    ipcRenderer.invoke('copies:restore', program, copyId),
  sourceChanged: (path: string): Promise<boolean> =>
    ipcRenderer.invoke('files:sourceChanged', path),
  onFilesChanged: (cb: (files: { changed: string[]; gone: string[] }) => void): (() => void) => {
    const handler = (_e: unknown, files: { changed: string[]; gone: string[] }) => cb(files)
    ipcRenderer.on('files:changed', handler)
    return () => ipcRenderer.removeListener('files:changed', handler)
  },
  onCopiesChanged: (cb: () => void): (() => void) => {
    const handler = () => cb()
    ipcRenderer.on('copies:changed', handler)
    return () => ipcRenderer.removeListener('copies:changed', handler)
  },
  openFeedback: (error?: string, stack?: string): Promise<void> =>
    ipcRenderer.invoke('feedback:open', error, stack),
  spectrogram: (path: string, priority: 'high' | 'low' = 'low') =>
    invokeAudio('audio:spectrogram', path, priority),
  loadCachedAnalyses: (
    paths: string[],
  ): Promise<Record<string, { spectrogram?: SpectrumVerdict; scanVerdict?: ScanVerdict }>> =>
    invokeAudio('audio:cached-batch', paths),
  peekAnalysis: <F extends keyof PeekableAnalyses>(family: F, path: string) =>
    invokeAudio('audio:peek', family, path) as Promise<PeekableAnalyses[F] | null>,
  recallAutoMatches: (paths: string[]) => invokeAudio('audio:recallAutoMatches', paths),
  rememberAutoMatch: (path: string, verdict: RememberedAutoMatch) =>
    invokeAudio('audio:rememberAutoMatch', path, verdict),
  loudness: (path: string, priority: 'high' | 'low' = 'low'): Promise<LoudnessResult | null> =>
    invokeAudio('audio:loudness', path, priority),
  fingerprint: (path: string, priority: 'high' | 'low' = 'low'): Promise<string | null> =>
    invokeAudio('audio:fingerprint', path, priority),
  comparePair: (a: string, b: string): Promise<PairFacts | null> => invokeAudio('audio:pair', a, b),
  limiterGlimpse: (
    worse: string,
    better: string,
    sampleRate: number,
  ): Promise<LimiterGlimpse | null> =>
    invokeAudio('audio:limiterGlimpse', worse, better, sampleRate),
  properties: (path: string): Promise<TrackProperties | null> =>
    invokeAudio('audio:properties', path),
  bpm: (path: string, priority: 'high' | 'low' = 'low'): Promise<BpmResult | null> =>
    invokeAudio('audio:bpm', path, priority),
  key: (path: string, priority: 'high' | 'low' = 'low'): Promise<KeyResult | null> =>
    invokeAudio('audio:key', path, priority),
  waveform: (
    path: string,
    priority: 'urgent' | 'high' | 'low' = 'low',
  ): Promise<WaveformResult | null> => invokeAudio('audio:waveform', path, priority),
  waveformScan: (path: string, priority: 'high' | 'low' = 'high'): Promise<WaveformScan | null> =>
    invokeAudio('audio:waveform-scan', path, priority),
  waveformWindow: (
    path: string,
    startSec: number,
    durSec: number,
    buckets: number,
  ): Promise<{ peaks: number[]; rms: number[] } | null> =>
    invokeAudio('audio:waveformWindow', path, startSec, durSec, buckets),
  declickPreview: (path, mode) => ipcRenderer.invoke('audio:declickPreview', path, mode),
  onDeclickPreviewProgress: (fn: (done: number) => void) => {
    const listener = (_e: unknown, done: number): void => fn(done)
    ipcRenderer.on('audio:declickPreviewProgress', listener)
    return () => ipcRenderer.off('audio:declickPreviewProgress', listener)
  },
  cancelDeclickPreview: () => ipcRenderer.invoke('audio:cancelDeclickPreview'),
  cancelAnalysis: (path: string): Promise<void> => ipcRenderer.invoke('audio:cancelAnalysis', path),
  clicks: (
    path: string,
    priority: 'high' | 'low' = 'low',
  ): Promise<{ count: number; marks: number[]; scannedSec: number } | null> =>
    invokeAudio('audio:clicks', path, priority),
  readTags: (path: string) => ipcRenderer.invoke('audio:tags', path),
  readDuration: (path: string) => ipcRenderer.invoke('audio:duration', path),
  readMeta: (path: string) => ipcRenderer.invoke('audio:meta', path),
  readMetaLight: (path: string) => ipcRenderer.invoke('audio:metaLight', path),
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
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  onUpdateCheckFailed: (cb: (status: number | null) => void) => {
    const listener = (_e: unknown, status: number | null): void => cb(status)
    ipcRenderer.on('update:check-failed', listener)
    return () => ipcRenderer.removeListener('update:check-failed', listener)
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
