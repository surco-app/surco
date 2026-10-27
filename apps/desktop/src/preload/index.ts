import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { AudioAnalysisIpc, PeekableAnalyses } from '../shared/audioIpcContract'
import type { DropInput } from '../shared/dropDetect'
import type { LearnedFlow } from '../shared/learnFlow'
import type {
  ActivityEvent,
  AppleMusicLookupCandidate,
  AppleMusicPlaylist,
  AppleMusicPlaylistTracks,
  AppleMusicTrackMeta,
  BpmResult,
  DockIconFrames,
  KeyResult,
  LibraryTracks,
  LimiterGlimpse,
  ListFixRequest,
  ListRemoval,
  LoudnessResult,
  MusicFieldFix,
  MusicFileLookup,
  MusicFixProgress,
  MusicReviewEntry,
  MusicReviewField,
  PairFacts,
  ProcessProgress,
  QueuedCues,
  RekordboxEditResult,
  RekordboxPlaylistEdit,
  RekordboxQueueApplied,
  RekordboxQueueState,
  RekordboxSyncIssue,
  RowWaveRequest,
  SaveCuesOutcome,
  SaveCuesRequest,
  ScanVerdict,
  SearchHints,
  SearchPriority,
  SearchProviderId,
  SessionData,
  SessionEdit,
  SourceNode,
  SourcePlaylistEntry,
  SpectrumVerdict,
  SurcoGrid,
  TrackCues,
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
} from '../shared/types'
import type { Api } from './api'

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
  expandPaths: (paths: string[]): Promise<string[]> => ipcRenderer.invoke('files:expand', paths),
  takePendingFiles: (): Promise<string[]> => ipcRenderer.invoke('files:pending'),
  onExpandedBatch: (cb: (paths: string[]) => void) => {
    const listener = (_e: unknown, paths: string[]): void => cb(paths)
    ipcRenderer.on('files:expanded', listener)
    return () => ipcRenderer.removeListener('files:expanded', listener)
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
  saveLastSession: (paths: string[], edits: Record<string, SessionEdit>): Promise<void> =>
    ipcRenderer.invoke('session:set', paths, edits),
  saveLastSessionSync: (paths: string[], edits: Record<string, SessionEdit>): void => {
    ipcRenderer.sendSync('session:set-sync', paths, edits)
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
  cacheStats: (): Promise<{ files: number; bytes: number }> => ipcRenderer.invoke('cache:stats'),
  clearCache: (): Promise<void> => ipcRenderer.invoke('cache:clear'),
  pickConfigDir: (): Promise<string | null> => ipcRenderer.invoke('dialog:pickConfigDir'),
  pickFiles: () => ipcRenderer.invoke('dialog:pickFiles'),
  pickOutputDir: () => ipcRenderer.invoke('dialog:pickOutputDir'),
  pickEngineLibraryDir: () => ipcRenderer.invoke('dialog:pickEngineLibraryDir'),
  pickTraktorNmlPath: () => ipcRenderer.invoke('dialog:pickTraktorNmlPath'),
  pickRekordboxDbPath: () => ipcRenderer.invoke('dialog:pickRekordboxDbPath'),
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
  exportRekordbox: (xml: string): Promise<string | null> =>
    ipcRenderer.invoke('dialog:exportRekordbox', xml),
  exportTraktor: (nml: string): Promise<string | null> =>
    ipcRenderer.invoke('dialog:exportTraktor', nml),
  exportSerato: (tracks: { inputPath: string; outputPath?: string }[]): Promise<string | null> =>
    ipcRenderer.invoke('dialog:exportSerato', tracks),
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
  setMusicField: (
    pid: string,
    field: MusicReviewField,
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
  loadAppleMusicPlaylistTracks: (persistentId: string): Promise<AppleMusicPlaylistTracks> =>
    ipcRenderer.invoke('applemusic:playlistTracks', persistentId),
  rekordboxAvailable: (): Promise<boolean> => ipcRenderer.invoke('rekordbox:available'),
  loadRekordboxTree: (): Promise<SourceNode[]> => ipcRenderer.invoke('rekordbox:tree'),
  rekordboxRecentCount: (): Promise<number> => ipcRenderer.invoke('rekordbox:recentCount'),
  loadRekordboxPlaylist: (id: string): Promise<SourcePlaylistEntry[]> =>
    ipcRenderer.invoke('rekordbox:playlist', id),
  engineAvailable: (): Promise<boolean> => ipcRenderer.invoke('engine:available'),
  loadEngineTree: (): Promise<SourceNode[]> => ipcRenderer.invoke('engine:tree'),
  engineRecentCount: (): Promise<number> => ipcRenderer.invoke('engine:recentCount'),
  loadEnginePlaylist: (id: string): Promise<SourcePlaylistEntry[]> =>
    ipcRenderer.invoke('engine:playlist', id),
  traktorAvailable: (): Promise<boolean> => ipcRenderer.invoke('traktor:available'),
  loadTraktorTree: (): Promise<SourceNode[]> => ipcRenderer.invoke('traktor:tree'),
  traktorRecentCount: (): Promise<number> => ipcRenderer.invoke('traktor:recentCount'),
  loadTraktorPlaylist: (id: string): Promise<SourcePlaylistEntry[]> =>
    ipcRenderer.invoke('traktor:playlist', id),
  editRekordboxPlaylist: (
    edit: RekordboxPlaylistEdit,
    label?: string,
  ): Promise<RekordboxEditResult> => ipcRenderer.invoke('rekordbox:edit', edit, label),
  rekordboxQueue: (): Promise<RekordboxQueueState> => ipcRenderer.invoke('rekordbox:queue'),
  applyRekordboxQueue: (): Promise<RekordboxQueueApplied | null> =>
    ipcRenderer.invoke('rekordbox:applyNow'),
  discardRekordboxQueue: (): Promise<void> => ipcRenderer.invoke('rekordbox:discardQueue'),
  rekordboxQueueReady: (): Promise<void> => ipcRenderer.invoke('rekordbox:queueReady'),
  rekordboxTrackCues: (contentId: string): Promise<TrackCues | null> =>
    ipcRenderer.invoke('rekordbox:trackCues', contentId),
  rekordboxCueWaveDetail: (contentId: string): Promise<Uint16Array | null> =>
    ipcRenderer.invoke('rekordbox:cueWaveDetail', contentId),
  rekordboxCueDropInput: (contentId: string): Promise<DropInput | null> =>
    ipcRenderer.invoke('rekordbox:cueDropInput', contentId),
  rekordboxCueTwins: (file: string): Promise<LibraryTracks> =>
    ipcRenderer.invoke('rekordbox:cueTwins', file),
  rekordboxAuditionLead: (contentId: string): Promise<number> =>
    ipcRenderer.invoke('rekordbox:auditionLead', contentId),
  rekordboxSurcoGrid: (contentId: string): Promise<SurcoGrid | null> =>
    ipcRenderer.invoke('rekordbox:surcoGrid', contentId),
  rowWaves: (requests: RowWaveRequest[]): Promise<Record<string, number[]>> =>
    ipcRenderer.invoke('list:rowWaves', requests),
  rekordboxCountCompletable: (): Promise<number> =>
    ipcRenderer.invoke('rekordbox:countCompletable'),
  rekordboxLearnFlow: (): Promise<LearnedFlow | null> => ipcRenderer.invoke('rekordbox:learnFlow'),
  rekordboxQueuedCues: (contentId: string): Promise<QueuedCues | null> =>
    ipcRenderer.invoke('rekordbox:queuedCues', contentId),
  undoRekordboxCues: (contentId: string): Promise<void> =>
    ipcRenderer.invoke('rekordbox:undoCues', contentId),
  saveRekordboxCues: (reqs: SaveCuesRequest[]): Promise<SaveCuesOutcome> =>
    ipcRenderer.invoke('rekordbox:saveCues', reqs),
  rekordboxMembership: (paths: string[]): Promise<Record<string, string[]>> =>
    ipcRenderer.invoke('rekordbox:membership', paths),
  onRekordboxQueueChanged: (cb: (state: RekordboxQueueState) => void) => {
    const listener = (_e: unknown, state: RekordboxQueueState): void => cb(state)
    ipcRenderer.on('rekordbox:queueChanged', listener)
    return () => ipcRenderer.removeListener('rekordbox:queueChanged', listener)
  },
  onRekordboxQueueApplied: (cb: (applied: RekordboxQueueApplied) => void) => {
    const listener = (_e: unknown, applied: RekordboxQueueApplied): void => cb(applied)
    ipcRenderer.on('rekordbox:queueApplied', listener)
    return () => ipcRenderer.removeListener('rekordbox:queueApplied', listener)
  },
  rekordboxHasSeparator: (): Promise<boolean> => ipcRenderer.invoke('rekordbox:hasSeparator'),
  editTraktorPlaylist: (
    edit: RekordboxPlaylistEdit,
    label?: string,
  ): Promise<RekordboxEditResult> => ipcRenderer.invoke('traktor:edit', edit, label),
  traktorHasSeparator: (): Promise<boolean> => ipcRenderer.invoke('traktor:hasSeparator'),
  engineCueQueue: (): Promise<RekordboxQueueState> => ipcRenderer.invoke('engine:cueQueue'),
  applyEngineCueQueue: (): Promise<RekordboxQueueApplied | null> =>
    ipcRenderer.invoke('engine:applyCueQueue'),
  discardEngineCueQueue: (): Promise<void> => ipcRenderer.invoke('engine:discardCueQueue'),
  engineCueQueueReady: (): Promise<void> => ipcRenderer.invoke('engine:cueQueueReady'),
  onEngineCueQueueChanged: (cb: (state: RekordboxQueueState) => void) => {
    const listener = (_e: unknown, state: RekordboxQueueState): void => cb(state)
    ipcRenderer.on('engine:cueQueueChanged', listener)
    return () => ipcRenderer.removeListener('engine:cueQueueChanged', listener)
  },
  onEngineCueQueueApplied: (cb: (applied: RekordboxQueueApplied) => void) => {
    const listener = (_e: unknown, applied: RekordboxQueueApplied): void => cb(applied)
    ipcRenderer.on('engine:cueQueueApplied', listener)
    return () => ipcRenderer.removeListener('engine:cueQueueApplied', listener)
  },
  traktorCueQueue: (): Promise<RekordboxQueueState> => ipcRenderer.invoke('traktor:cueQueue'),
  applyTraktorCueQueue: (): Promise<RekordboxQueueApplied | null> =>
    ipcRenderer.invoke('traktor:applyCueQueue'),
  discardTraktorCueQueue: (): Promise<void> => ipcRenderer.invoke('traktor:discardCueQueue'),
  traktorCueQueueReady: (): Promise<void> => ipcRenderer.invoke('traktor:cueQueueReady'),
  onTraktorCueQueueChanged: (cb: (state: RekordboxQueueState) => void) => {
    const listener = (_e: unknown, state: RekordboxQueueState): void => cb(state)
    ipcRenderer.on('traktor:cueQueueChanged', listener)
    return () => ipcRenderer.removeListener('traktor:cueQueueChanged', listener)
  },
  onTraktorCueQueueApplied: (cb: (applied: RekordboxQueueApplied) => void) => {
    const listener = (_e: unknown, applied: RekordboxQueueApplied): void => cb(applied)
    ipcRenderer.on('traktor:cueQueueApplied', listener)
    return () => ipcRenderer.removeListener('traktor:cueQueueApplied', listener)
  },
  traktorCanSave: (): Promise<boolean> => ipcRenderer.invoke('traktor:canSave'),
  usbVolumes: (): Promise<UsbVolumeList> => ipcRenderer.invoke('usb:volumes'),
  onUsbVolumesChanged: (cb: (list: UsbVolumeList) => void) => {
    const listener = (_e: unknown, list: UsbVolumeList): void => cb(list)
    ipcRenderer.on('usb:volumesChanged', listener)
    return () => ipcRenderer.removeListener('usb:volumesChanged', listener)
  },
  usbPickFolder: (source?: 'engine'): Promise<UsbFolderPick | null> =>
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
  releasePlayingFile: (path) => ipcRenderer.invoke('player:release', path),
  beginConversionBatch: (): void => ipcRenderer.send('process:batch-begin'),
  endConversionBatch: (): void => ipcRenderer.send('process:batch-end'),
  cancelJob: (jobId: string): void => ipcRenderer.send('process:cancel', jobId),
  reportUnsavedCues: (tracks: number): void => ipcRenderer.send('cues:unsaved', tracks),
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
  trashList: (): Promise<TrashEntry[]> => ipcRenderer.invoke('trash:list'),
  trashRestore: (id: string, from?: 'undo'): Promise<{ restoredTo: string }> =>
    ipcRenderer.invoke('trash:restore', id, from),
  trashRemove: (id: string): Promise<void> => ipcRenderer.invoke('trash:remove', id),
  trashEmpty: (): Promise<void> => ipcRenderer.invoke('trash:empty'),
  trashReveal: (): Promise<void> => ipcRenderer.invoke('trash:reveal'),
  copyText: (text: string): Promise<void> => ipcRenderer.invoke('clipboard:write', text),
  logError: (message: string, stack?: string): void =>
    ipcRenderer.send('log:renderer', message, stack),
  revealLog: (): Promise<void> => ipcRenderer.invoke('log:reveal'),
  revealBackups: (): Promise<string> => ipcRenderer.invoke('backups:reveal'),
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
  waveformScan: (path: string): Promise<WaveformScan | null> =>
    invokeAudio('audio:waveform-scan', path),
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
  onRekordboxSyncIssue: (cb: (issue: RekordboxSyncIssue) => void) => {
    const listener = (_e: unknown, issue: RekordboxSyncIssue): void => cb(issue)
    ipcRenderer.on('rekordbox:sync-issue', listener)
    return () => ipcRenderer.removeListener('rekordbox:sync-issue', listener)
  },
  onEngineSyncIssue: (cb: (issue: RekordboxSyncIssue) => void) => {
    const listener = (_e: unknown, issue: RekordboxSyncIssue): void => cb(issue)
    ipcRenderer.on('engine:sync-issue', listener)
    return () => ipcRenderer.removeListener('engine:sync-issue', listener)
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
