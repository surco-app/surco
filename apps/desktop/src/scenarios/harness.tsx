import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, renderHook, waitFor } from '@testing-library/react'
import { app } from 'electron'
import type React from 'react'
import { useRef } from 'react'
import { expect } from 'vitest'
import { activity } from '../main/activity'
import { registerAppleMusicIpc } from '../main/appleMusicIpc'
import * as appleMusic from '../main/applemusic'
import { registerAudioIpc } from '../main/audioIpc'
import { hasCoverSource, prepareProcessedCover } from '../main/cover'
import { replaceDuplicates } from '../main/duplicateReplace'
import { addToEngineLibrary } from '../main/engineLibrary'
import { expandPaths } from '../main/expand'
import { convertAudio } from '../main/ffmpeg'
import { isSameFile, removeRenamedOriginal } from '../main/inplace'
import {
  currentLibraryStatus,
  duplicateLibraryDeps,
  flushConversionBatch,
  type LibraryHost,
  syncTagsInLibraries,
} from '../main/libraryFlushes'
import { registerListReviewIpc } from '../main/listReviewIpc'
import { listReviewDeps } from '../main/listReviewWiring'
import { createMediaAccess } from '../main/mediaAccess'
import { musicReviewLog } from '../main/musicReviewLog'
import { beginNmlBatch } from '../main/nmlBatch'
import { configureBackupStore } from '../main/originalKeeper'
import { createOutputReservations } from '../main/outputReservations'
import { runProcessTrack } from '../main/processTrack'
import { trashRecoverably } from '../main/recoverableTrash'
import { beginRekordboxBatch, redirectRekordboxRepoint } from '../main/rekordboxBatch'
import { createSessionBackup } from '../main/rekordboxSessionBackup'
import { getSettings, recordConversion, recordStat, replaceSettings } from '../main/settings'
import { registerShellIpc } from '../main/shellIpc'
import { createSurcoTrash, type SurcoTrash } from '../main/surcoTrash'
import { createTmpManifest } from '../main/tmpManifest'
import { registerTrashIpc } from '../main/trashIpc'
import { onWatchedFilesChanged } from '../main/watchedFiles'
import { dirRoots, FolderWatcher } from '../main/watcher'
import type { Api } from '../preload/api'
import { AlbumMatchRows } from '../renderer/src/components/AlbumMatchRows'
import { FindReplaceModal } from '../renderer/src/components/FindReplaceModal'
import { useAppleMusicFill } from '../renderer/src/hooks/useAppleMusicFill'
import { useConfirmFlows } from '../renderer/src/hooks/useConfirmFlows'
import { useLibraryVerdict } from '../renderer/src/hooks/useLibraryVerdict'
import {
  type MusicReview,
  pendingGroups,
  type ReviewFilter,
  useMusicReview,
} from '../renderer/src/hooks/useMusicReview'
import type { ConfirmModal } from '../renderer/src/hooks/useOverlays'
import { useQualityAnalysis } from '../renderer/src/hooks/useQualityAnalysis'
import { useTrackLibrary } from '../renderer/src/hooks/useTrackLibrary'
import { useTrackProcessing } from '../renderer/src/hooks/useTrackProcessing'
import { useTracksView } from '../renderer/src/hooks/useTracksView'
import { waveformOptions } from '../renderer/src/hooks/useWaveform'
import { removeAnalysisQueries } from '../renderer/src/lib/analysisQueries'
import {
  isAmbiguousCandidate,
  type ReplaceCandidate,
  type StaleLibraryCopy,
} from '../renderer/src/lib/appleMusicLibrary'
import { musicEntries } from '../renderer/src/lib/appleMusicSource'
import { acceptReviewPatch } from '../renderer/src/lib/autoMatch'
import type { BatchSummary } from '../renderer/src/lib/batch'
import { type Destination, fromDestination, toDestination } from '../renderer/src/lib/destination'
import { librarySourceOf } from '../renderer/src/lib/librarySource'
import { listReviewEntries } from '../renderer/src/lib/listReviewEntries'
import { listReviewSource } from '../renderer/src/lib/listReviewSource'
import { createQueryClient } from '../renderer/src/lib/queryClient'
import { replacePatch } from '../renderer/src/lib/replaceBeforeConvert'
import { musicSource, type ReviewSource } from '../renderer/src/lib/reviewSource'
import { SettingsProvider } from '../renderer/src/lib/settingsContext'
import { supersededFile } from '../renderer/src/lib/supersededFile'
import { detectTrim } from '../renderer/src/lib/trim'
import type { TrackItem } from '../renderer/src/types'
import { trashLimits } from '../shared/backupPolicy'
import { normalizeImportFields } from '../shared/defaults'
import { resolveJobFormat } from '../shared/format'
import type {
  FormatSetting,
  ProcessJob,
  ProcessResult,
  Release,
  SearchResult,
  Settings,
} from '../shared/types'
import { ipcHandlers } from './electronFake'
import '../renderer/src/i18n'

const PLENTY_OF_DISK = 500 * 1024 ** 3

export type ConflictChoice = 'overwrite' | 'keepBoth' | 'skip'

export interface ScenarioOptions {
  settings: Partial<Settings>
  destination?: Destination
  onConflict?: (outputName: string) => ConflictChoice
}

const musicIsFake = (appleMusic as Record<string, unknown>).scenarioFake === true

function noMusic(): Promise<never> {
  return Promise.reject(new Error('scenario: this test did not load the Apple Music fake'))
}

const rendererListeners = new Map<string, Set<(...args: never[]) => void>>()
const sender = {
  send: (channel: string, ...args: unknown[]) => {
    for (const listener of rendererListeners.get(channel) ?? []) listener(...(args as never[]))
  },
  isDestroyed: () => false,
}
const mediaAccess = createMediaAccess()

export function listen(channel: string, listener: (...args: never[]) => void): () => void {
  const set = rendererListeners.get(channel) ?? new Set()
  rendererListeners.set(channel, set)
  set.add(listener)
  return () => set.delete(listener)
}

export function invokeMain<T>(channel: string, ...args: unknown[]): Promise<T> {
  const handler = ipcHandlers.get(channel)
  if (!handler) throw new Error(`scenario: main never registered ${channel}`)
  return Promise.resolve(handler({ sender }, ...(args as never[]))) as Promise<T>
}

function processTrackInMain(
  job: ProcessJob,
  reservations: ReturnType<typeof createOutputReservations>,
  options: ScenarioOptions,
  errors: string[],
  appleMusicSends: string[],
): Promise<ProcessResult> {
  const manifest = createTmpManifest(join(app.getPath('userData'), 'pending-tmp.json'), {
    readFileSync: (p) => readFileSync(p, 'utf8'),
    writeFileSync,
    existsSync,
    unlinkSync,
  })
  return runProcessTrack(job, {
    settings: getSettings(),
    platform: process.platform,
    sendProgress: () => {},
    hasCoverSource,
    prepareProcessedCover,
    isPathReserved: reservations.isReserved,
    reservePath: reservations.reserve,
    releasePath: reservations.release,
    registerActiveConversion: () => {},
    unregisterActiveConversion: () => {},
    beginJob: () => {},
    endJob: () => {},
    trackTmp: manifest.track,
    untrackTmp: manifest.untrack,
    convertAudio: (
      input,
      output,
      format,
      meta,
      coverPath,
      normalize,
      removeCover,
      onChild,
      onTmp,
      declick,
      trim,
      clearExtras,
      foreignRemoved,
      replacesPath,
    ) => {
      const s = getSettings()
      return convertAudio(
        input,
        output,
        format,
        meta,
        coverPath,
        normalize,
        removeCover,
        {
          mp3Quality: s.mp3Quality,
          bitDepth: s.outputBitDepth,
          sampleRate: s.outputSampleRate,
          flacCompression: s.flacCompression,
        },
        onChild,
        onTmp,
        s.flacFinderCovers && process.platform === 'darwin',
        declick,
        trim,
        clearExtras,
        foreignRemoved,
        replacesPath,
      )
    },
    recordConversion,
    removeRenamedOriginal,
    addToAppleMusic: async (target, meta, coverPath) => {
      appleMusicSends.push(target)
      return musicIsFake
        ? appleMusic.addToAppleMusic(target, meta, coverPath)
        : `scenario-pid-${appleMusicSends.length}`
    },
    updateInAppleMusic: (pid, meta, coverPath) =>
      musicIsFake ? appleMusic.updateInAppleMusic(pid, meta, coverPath) : noMusic(),
    addToEngineDj: (target, meta, coverPath, replaces) => {
      const s = getSettings()
      return addToEngineLibrary(
        s.engineLibraryDir,
        target,
        meta,
        s.engineDjPlaylist,
        coverPath,
        s.syncEngineDj ? replaces : undefined,
        (db) => sessions.engine.ensure(db),
      )
    },
    allowMedia: (path) => mediaAccess.allow(path),
    existsSync,
    isSameFile,
    mkdir,
    mkdtemp,
    rm,
    confirmConflict: async (outputName) => {
      if (!options.onConflict) {
        errors.push(`unexpected conflict prompt for ${outputName}`)
        return 'skip'
      }
      return options.onConflict(outputName)
    },
    appleMusicEntryLocation: (pid) =>
      musicIsFake ? appleMusic.appleMusicEntryLocation(pid) : noMusic(),
    deleteAppleMusic: (pid, label) =>
      musicIsFake ? appleMusic.deleteFromAppleMusic(pid, label) : noMusic(),
    redirectRepoint: redirectRekordboxRepoint,
  })
}

const sessions = { rekordbox: createSessionBackup({}), engine: createSessionBackup({}) }

function libraryHost(errors: string[]): LibraryHost {
  return {
    ensureTraktorClosed: async () => true,
    ensureRekordboxClosed: async () => true,
    ensureEngineDjClosed: async () => true,
    showBlockedDialog: (key) => errors.push(`library sync blocked: ${key}`),
    reportIssue: (channel, issue) => errors.push(`${channel}: ${JSON.stringify(issue)}`),
    rekordboxHeld: () => false,
  }
}

let watcher: FolderWatcher | undefined

function scenarioApi(
  options: ScenarioOptions,
  errors: string[],
  appleMusicSends: string[],
  flushes: Promise<void>[],
): Api {
  const reservations = createOutputReservations()
  const expandedListeners = new Set<(paths: string[]) => void>()
  const folderListeners = new Set<(root: string, files: string[]) => void>()
  watcher = new FolderWatcher((root, files) =>
    onWatchedFilesChanged(
      mediaAccess,
      reservations.isReserved,
      (r, f) => {
        for (const listener of folderListeners) listener(r, f)
      },
      root,
      files,
    ),
  )
  const wired: Partial<Api> = {
    platform: process.platform,
    // No scenario has a rekordbox collection: the source rail stays without it, and the
    // queries App mounts get an answer instead of the proxy's "not wired" throw.
    rekordboxAvailable: async () => false,
    loadRekordboxTree: async () => [],
    loadRekordboxPlaylist: async () => [],
    rekordboxHasSeparator: async () => false,
    editRekordboxPlaylist: async () => ({ applied: false, reason: 'unreadable' }),
    rekordboxQueue: async () => ({ tracks: 0, changes: 0, items: [] }),
    applyRekordboxQueue: async () => null,
    discardRekordboxQueue: async () => {},
    rekordboxQueueReady: async () => {},
    rekordboxTrackCues: async () => null,
    saveRekordboxCues: async () => {},
    rekordboxQueuedCues: async () => null,
    undoRekordboxCues: async () => {},
    rekordboxMembership: async () => ({}),
    onRekordboxQueueChanged: () => () => {},
    onRekordboxQueueApplied: () => () => {},
    usbVolumes: async () => ({ volumes: [], lastKey: null }),
    onUsbVolumesChanged: () => () => {},
    onUsbEvent: () => () => {},
    expandPaths: async (paths) => {
      const expanded = await expandPaths(paths, (batch) => {
        mediaAccess.allowAll(batch)
        for (const listener of expandedListeners) listener(batch)
      })
      mediaAccess.allowAll(expanded)
      const roots = await dirRoots(paths)
      if (roots.length) watcher?.watch(roots)
      return expanded
    },
    onExpandedBatch: (listener) => {
      expandedListeners.add(listener)
      return () => expandedListeners.delete(listener)
    },
    onOpenFiles: () => () => {},
    onFoldersChanged: (listener) => {
      folderListeners.add(listener)
      return () => folderListeners.delete(listener)
    },
    takePendingFiles: async () => [],
    unwatchFolders: async () => watcher?.close(),
    recordStat: (key, by) => recordStat(key, by),
    readMeta: (path) => invokeMain('audio:meta', path),
    spectrogram: (path, priority) => invokeMain('audio:spectrogram', path, priority),
    loudness: (path, priority) => invokeMain('audio:loudness', path, priority),
    fingerprint: (path, priority) => invokeMain('audio:fingerprint', path, priority),
    comparePair: (a, b) => invokeMain('audio:pair', a, b),
    peekAnalysis: (family, path) => invokeMain('audio:peek', family, path),
    bpm: (path, priority) => invokeMain('audio:bpm', path, priority),
    key: (path, priority) => invokeMain('audio:key', path, priority),
    clicks: (path, priority) => invokeMain('audio:clicks', path, priority),
    waveform: (path, priority) => invokeMain('audio:waveform', path, priority),
    waveformScan: (path) => invokeMain('audio:waveform-scan', path),
    cancelAnalysis: (path) => invokeMain('audio:cancelAnalysis', path),
    onWindowFocus: () => () => {},
    libraryStatus: async () => currentLibraryStatus(),
    syncLibraryTags: (updates) => syncTagsInLibraries(updates, libraryHost(errors), sessions),
    applyListFixes: (request) => invokeMain('listreview:applyFixes', request),
    cancelListFixes: () => invokeMain('listreview:cancelFixes'),
    onListFixProgress: (listener) => listen('listreview:fixProgress', listener),
    removeListDuplicates: (removals) => invokeMain('listreview:removeDuplicates', removals),
    onListRemovalPhase: (listener) => listen('listreview:removalPhase', listener),
    trashRestore: (id, from) => invokeMain('trash:restore', id, from),
    trashFile: (path, permanent) => invokeMain('shell:trash', path, permanent),
    keepsTrash: (path) => invokeMain('shell:keepsTrash', path),
    properties: (path) => invokeMain('audio:properties', path),
    ...(musicIsFake && {
      appleMusicEntryLocation: (pid) => invokeMain('applemusic:entryLocation', pid),
      appleMusicEntryMeta: (path, pids) => invokeMain('applemusic:entryMeta', path, pids),
      loadAppleMusicLibrary: () => invokeMain('applemusic:library'),
      loadAppleMusicLibraryCached: () => invokeMain('applemusic:libraryCached'),
      appleMusicFileEntries: (candidates, launch) =>
        invokeMain('applemusic:fileEntries', candidates, launch),
      loadMusicReview: () => invokeMain('applemusic:reviewDump'),
      applyMusicFixes: (fixes) => invokeMain('applemusic:applyFixes', fixes),
      cancelMusicFixes: () => invokeMain('applemusic:cancelFixes'),
      onMusicFixProgress: (listener) => listen('applemusic:fixProgress', listener),
      setMusicField: (pid, field, from, to, location) =>
        invokeMain('applemusic:setField', pid, field, from, to, location),
      removeMusicDuplicate: (request) => invokeMain('applemusic:removeDuplicate', request),
      replaceDuplicatesInLibraries: (pairs) =>
        replaceDuplicates(pairs, {
          ...duplicateLibraryDeps(libraryHost(errors), sessions),
          trash: (path) => trashRecoverably(path),
          log: { track: activity.track, copyOf: musicReviewLog.copyOf },
        }),
      loadAppleMusicPlaylists: () => invokeMain('applemusic:playlists'),
      loadAppleMusicPlaylistTracks: (pid) => invokeMain('applemusic:playlistTracks', pid),
      addToAppleMusic: (job) => invokeMain('applemusic:add', job),
      updateAppleMusic: (job) => invokeMain('applemusic:update', job),
      deleteAppleMusic: (pid, track) => invokeMain('applemusic:delete', pid, track),
    }),
    beginConversionBatch: () => {
      beginNmlBatch()
      beginRekordboxBatch()
      sessions.rekordbox.reset()
      sessions.engine.reset()
    },
    endConversionBatch: () => {
      flushes.push(
        flushConversionBatch(libraryHost(errors), sessions, {
          enqueue: () => {},
          applyQuietly: () => {},
        }),
      )
    },
    processTrack: (job) => processTrackInMain(job, reservations, options, errors, appleMusicSends),
  }
  return new Proxy(wired as Api, {
    get(target, key) {
      if (key in target) return target[key as keyof Api]
      throw new Error(`scenario: window.api.${String(key)} is not wired`)
    },
  })
}

function clickEnabled(button: HTMLElement): void {
  if ((button as HTMLButtonElement).disabled)
    throw new Error(`scenario: ${button.dataset.testid} is disabled, the user could not press it`)
  fireEvent.click(button)
}

function searchResultOf(release: Release): SearchResult {
  return { provider: release.provider, id: release.id, title: release.title }
}

export interface Scenario {
  tracks: () => TrackItem[]
  drop: (...paths: string[]) => Promise<void>
  convertAll: (answer?: 'confirm' | 'cancel', format?: FormatSetting) => Promise<void>
  importPlaylist: (
    persistentId: string,
    name: string,
  ) => Promise<{ name: string; imported: number; missing: number }>
  prompts: Pick<ConfirmModal, 'title' | 'message'>[]
  patchTrack: (fileName: string, patch: Partial<TrackItem>) => void
  editMeta: (fileName: string, patch: Partial<TrackItem['meta']>) => void
  acceptMatch: (fileName: string, release: Release, position: string) => void
  findAndReplace: (find: string, replace: string, options?: { regex?: boolean }) => string
  applyAlbum: (release: Release) => void
  trimDetectedSilence: () => Promise<void>
  rows: () => TrackItem[]
  summary: () => BatchSummary | null
  reviewNotice: (dropped: string[]) => ReturnType<typeof pendingGroups>
  openListReview: () => Promise<() => MusicReview>
  convertInEditor: (
    fileName: string,
  ) => Promise<{ replaces: boolean; target: ReplaceCandidate | null }>
  cleanUp: (fileName: string) => Promise<void>
  openMusicReview: (filter?: ReviewFilter) => Promise<() => MusicReview>
  waitForNewTracks: () => Promise<string[]>
  loadNewTracks: () => Promise<void>
  dismissNewTracks: () => void
  close: () => void
  waitForAnalysis: () => Promise<void>
  trash: SurcoTrash
  errors: string[]
  sentToAppleMusic: string[]
}

// The main process every scenario runs against: settings, the backup store, the real IPC
// handlers, and the window.api bridge wired to them. Shared by the hook-level harness and
// the whole-app one, so both drive the same main.
export interface MainBoot {
  settings: Settings
  trash: SurcoTrash
  errors: string[]
  sentToAppleMusic: string[]
  flushes: Promise<void>[]
  api: Api
}

export function bootMain(options: ScenarioOptions): MainBoot {
  const settings = replaceSettings({
    ...options.settings,
    ...(options.destination && fromDestination(options.destination)),
  })
  const trash = createSurcoTrash(
    join(app.getPath('userData'), 'trash'),
    () => trashLimits(getSettings()),
    async () => PLENTY_OF_DISK,
  )
  configureBackupStore(trash, () => getSettings().backupPolicy)
  if (!ipcHandlers.has('audio:meta')) {
    registerAudioIpc((path) => mediaAccess.allow(path))
    registerTrashIpc(trash, mediaAccess)
    registerShellIpc(mediaAccess)
    if (musicIsFake) registerAppleMusicIpc()
    registerListReviewIpc(
      listReviewDeps({
        mediaAccess,
        tmp: { track: () => {}, untrack: () => {} },
        hostFor: () => libraryHost(errors),
        sessions,
      }),
    )
  }
  const errors: string[] = []
  const sentToAppleMusic: string[] = []
  const flushes: Promise<void>[] = []
  const api = scenarioApi(options, errors, sentToAppleMusic, flushes)
  return { settings, trash, errors, sentToAppleMusic, flushes, api }
}

export function closeMain(): void {
  watcher?.close()
}

export async function openSurco(options: ScenarioOptions): Promise<Scenario> {
  const { settings, trash, errors, sentToAppleMusic, flushes, api } = bootMain(options)
  const prompts: ConfirmModal[] = []
  const editorVerdicts = new Map<string, () => ReturnType<typeof useLibraryVerdict>>()
  let running: Promise<void> | undefined
  ;(window as unknown as { api: Api }).api = api

  const queryClient = createQueryClient()
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  const rowsCache = { current: new Map() }
  const { result } = renderHook(
    () => {
      const analyzeRef = useRef<(tracks: TrackItem[]) => void>(() => {})
      const forgetRef = useRef<(ids: string[]) => void>(() => {})
      const library = useTrackLibrary({
        setSelection: () => {},
        onForget: () => {},
        onRemove: (removed) => {
          removeAnalysisQueries(
            queryClient,
            removed.map((t) => t.inputPath),
          )
          forgetRef.current(removed.map((t) => t.id))
        },
        onClear: () => {},
        onMetaLoaded: (track) => {
          if (settings.autoAnalyze) analyzeRef.current([track])
        },
        onDuplicatesSkipped: () => {},
        onNoAudioFound: () => errors.push('no audio found in the drop'),
        onMetaReadFailed: (count) => errors.push(`${count} metadata reads failed`),
      })
      const processing = useTrackProcessing({
        tracks: library.tracks,
        tracksRef: library.tracksRef,
        settings,
        updateTrack: library.updateTrack,
        refreshTrackFromDisk: library.refreshTrackFromDisk,
        rereadTrackMeta: library.rereadTrackMeta,
        onProcessError: (message, name) => errors.push(`${name}: ${message}`),
      })
      const quality = useQualityAnalysis({
        targetsRef: library.tracksRef,
        onErrors: (ids) => errors.push(`${ids.length} tracks could not be analysed`),
      })
      analyzeRef.current = (tracks) => quality.analyzeAllQuality(tracks)
      forgetRef.current = quality.forgetTracks
      const view = useTracksView(
        library.tracks,
        rowsCache,
        librarySourceOf(settings, process.platform === 'darwin'),
      )
      const confirmFlows = useConfirmFlows({
        settings,
        removeTrack: library.removeTrack,
        updateTrack: library.updateTrack,
        emptyTracks: (targets) => library.removeTracks(targets.map((t) => t.id)),
        deriveTracks: () => {},
        processAll: (...args) => {
          running = processing.processAll(...args)
          return running
        },
        openConfirm: (modal) => prompts.push(modal),
        reportTrashFailure: (fileName) => errors.push(`trash failed: ${fileName}`),
        onOldMusicCopyRemoved: () => {},
        reportOldCopyRemoveFailure: () => errors.push('old Apple Music copy not removed'),
        tracksRef: library.tracksRef,
      })
      return { library, processing, confirmFlows, quality, view }
    },
    { wrapper },
  )

  const tracks = () => result.current.library.tracksRef.current
  const trackNamed = (fileName: string): TrackItem => {
    const track = tracks().find((t) => basename(t.inputPath) === fileName)
    if (!track) throw new Error(`scenario: no track named ${fileName} in the list`)
    return track
  }

  const mountReview = async (
    source: ReviewSource,
    initialFilter: ReviewFilter,
  ): Promise<() => MusicReview> => {
    const review = renderHook(() =>
      useMusicReview({
        source,
        initialFilter,
        ignored: [],
        saveIgnored: () => {},
        onFilesChanged: async (updates) => {
          for (const { path, fields } of updates) {
            result.current.library.patchReviewedFields(path, fields)
            for (const row of tracks().filter((r) => r.inputPath === path))
              await result.current.library.refreshTrackFromDisk(row.id, path)
          }
        },
      }),
    )
    await waitFor(() => expect(review.result.current.status).not.toBe('loading'))
    return () => review.result.current
  }

  return {
    tracks,
    rows: () => result.current.view.tracksView,
    summary: () => result.current.processing.batchSummary,
    reviewNotice: (dropped) =>
      pendingGroups(
        listReviewEntries(result.current.view.tracksView).entries,
        [],
        new Set(dropped),
      ),
    openListReview: async () => {
      const source = listReviewSource({
        rows: () => result.current.view.tracksView,
        mac: process.platform === 'darwin',
        launchMusic: () => false,
        onRowsRemoved: (paths) =>
          result.current.library.removeTracks(
            tracks()
              .filter((t) => paths.includes(t.inputPath))
              .map((t) => t.id),
          ),
      })
      return mountReview(source, 'all')
    },
    openMusicReview: (filter = 'all') => mountReview(musicSource, filter),
    convertInEditor: async (fileName) => {
      const id = trackNamed(fileName).id
      await waitFor(() => expect(result.current.view.libraryIndex).not.toBeNull())
      const editor = renderHook(() => {
        const item = tracks().find((t) => t.id === id) as TrackItem
        const onChange = (patch: Partial<TrackItem>) =>
          result.current.library.updateTrack(id, patch)
        const verdict = useLibraryVerdict({
          item,
          libraryIndex: result.current.view.libraryIndex,
          librarySource: librarySourceOf(settings, process.platform === 'darwin'),
          suggestedMeta: undefined,
          onChange,
        })
        const target = verdict.replaceTarget
        useAppleMusicFill({
          item,
          onChange,
          candidates: item.musicPersistentId
            ? [item.musicPersistentId]
            : !target
              ? []
              : isAmbiguousCandidate(target)
                ? target.ambiguous
                : [target.persistentId],
        })
        return verdict
      })
      editorVerdicts.set(fileName, () => editor.result.current)
      const target = editor.result.current.replaceTarget
      if (target && !isAmbiguousCandidate(target))
        await waitFor(() =>
          expect((editor.result.current.replaceTarget as StaleLibraryCopy)?.path).toBeTruthy(),
        )
      const offered = editor.result.current.replaceTarget
      const replaces = !!offered && !isAmbiguousCandidate(offered)
      const destination = toDestination(
        settings.addToAppleMusic,
        settings.outputFormat === 'flac',
        settings.overwriteOriginal,
        settings.addToEngineDj,
        settings.convertBesideOriginal,
      )
      await act(async () => {
        const patch = replacePatch(offered)
        if (patch) result.current.library.updateTrack(id, patch)
        const track = tracks().find((t) => t.id === id) as TrackItem
        const format = resolveJobFormat(
          settings.outputFormat,
          track.inputPath,
          'aiff',
          settings.keepMp3Sources,
          track.fromAppleMusic,
        )
        const normalize = track.normalize ?? settings.normalize
        const declick = track.declick ?? settings.declick
        let converting: Promise<unknown> = Promise.resolve()
        result.current.confirmFlows.askConvertOne(
          () => {
            converting = result.current.processing.processOne(
              id,
              format,
              normalize,
              undefined,
              destination,
              declick,
            )
          },
          { destination, track, format, normalize, declick },
        )
        await converting
        await Promise.all(flushes)
      })
      return { replaces, target: offered }
    },
    cleanUp: async (fileName) => {
      const track = trackNamed(fileName)
      const superseded = supersededFile(track)
      const asked = prompts.length
      await act(async () => {
        await result.current.confirmFlows.askCleanUp(track, {
          originalPath: null,
          superseded: superseded ? [{ trackId: track.id, path: superseded }] : [],
          staleMusicCopy: editorVerdicts.get(fileName)?.().staleMusicCopy ?? null,
        })
      })
      await waitFor(() => expect(prompts.length).toBeGreaterThan(asked))
      await act(async () => {
        prompts[prompts.length - 1].onConfirm()
        await new Promise((resolve) => setTimeout(resolve, 200))
      })
    },
    waitForNewTracks: async () => {
      await waitFor(() => expect(result.current.library.pendingNew).not.toBeNull(), {
        timeout: 5_000,
      })
      return result.current.library.pendingNew?.paths ?? []
    },
    loadNewTracks: async () => {
      act(() => result.current.library.loadPending())
      await waitFor(() => expect(tracks().some((t) => t.loadingMeta)).toBe(false), {
        timeout: 20_000,
      })
    },
    dismissNewTracks: () => act(() => result.current.library.dismissPending()),
    close: () => watcher?.close(),
    waitForAnalysis: async () => {
      await waitFor(
        () => {
          expect(result.current.quality.analysis).toBeNull()
          expect(result.current.view.tracksView.every((row) => row.spectrum)).toBe(true)
        },
        { timeout: 60_000 },
      )
    },
    trash,
    errors,
    sentToAppleMusic,
    prompts,
    drop: async (...paths) => {
      await act(async () => {
        await result.current.library.addPaths(await window.api.expandPaths(paths))
      })
      await waitFor(() => expect(tracks().some((t) => t.loadingMeta)).toBe(false), {
        timeout: 20_000,
      })
    },
    patchTrack: (fileName, patch) => {
      const track = trackNamed(fileName)
      act(() => result.current.library.updateTrack(track.id, patch))
    },
    editMeta: (fileName, patch) => {
      const track = trackNamed(fileName)
      act(() => result.current.library.updateTrack(track.id, { meta: { ...track.meta, ...patch } }))
    },
    acceptMatch: (fileName, release, position) => {
      const track = trackNamed(fileName)
      const releaseTrack = release.tracklist.find((t) => t.position === position)
      if (!releaseTrack) throw new Error(`scenario: release has no track at ${position}`)
      const patch = acceptReviewPatch(
        {
          ...track,
          reviewMatch: { release, track: releaseTrack, result: searchResultOf(release) },
        },
        normalizeImportFields(settings.importFields),
        settings.genrePresets,
        settings.fullReleaseDate,
      )
      if (!patch) throw new Error('scenario: the match produced no patch')
      act(() => result.current.library.updateTrack(track.id, patch))
    },
    findAndReplace: (find, replace, { regex = false } = {}) => {
      const modal = render(
        <FindReplaceModal
          tracks={tracks()}
          customFields={settings.customFields}
          onApply={(patches) => result.current.library.deriveTracks(patches)}
          onClose={() => {}}
        />,
      )
      if (regex) fireEvent.click(modal.getByTestId('find-replace-regex'))
      fireEvent.change(modal.getByTestId('find-replace-find'), { target: { value: find } })
      fireEvent.change(modal.getByTestId('find-replace-replace'), { target: { value: replace } })
      const preview = modal.getByTestId('find-replace-preview').textContent ?? ''
      clickEnabled(modal.getByTestId('find-replace-apply'))
      modal.unmount()
      return preview
    },
    applyAlbum: (release) => {
      const rows = render(
        <SettingsProvider settings={settings}>
          <AlbumMatchRows
            files={tracks()}
            release={release}
            onApply={(patches, provider) => {
              for (const p of patches)
                result.current.library.updateTrack(p.id, {
                  ...p.patch,
                  matched: true,
                  matchProvider: provider,
                })
            }}
          />
        </SettingsProvider>,
      )
      act(() => clickEnabled(rows.getByTestId('match-apply')))
      rows.unmount()
    },
    trimDetectedSilence: async () => {
      for (const t of tracks().filter((track) => !track.trim)) {
        const wave = await queryClient.fetchQuery(waveformOptions(t.inputPath))
        const suggestion = wave ? detectTrim(wave) : undefined
        if (suggestion) act(() => result.current.library.updateTrack(t.id, { trim: suggestion }))
      }
    },
    importPlaylist: async (persistentId, name) => {
      const before = tracks().length
      const entries = musicEntries(await window.api.loadAppleMusicPlaylistTracks(persistentId))
      await act(async () => {
        await result.current.library.openSourcePlaylist(entries, 'appleMusic')
      })
      await waitFor(() => expect(tracks().some((t) => t.loadingMeta)).toBe(false), {
        timeout: 20_000,
      })
      return {
        name,
        imported: tracks().length - before,
        missing: entries.filter((e) => e.path === null).length,
      }
    },
    convertAll: async (answer = 'confirm', format) => {
      running = undefined
      const asked = prompts.length
      act(() => result.current.confirmFlows.askConvertAll(tracks(), format))
      await waitFor(() => expect(running !== undefined || prompts.length > asked).toBe(true))
      if (!running && answer === 'confirm') act(() => prompts[prompts.length - 1].onConfirm())
      await act(async () => {
        await running
        await Promise.all(flushes)
      })
    },
  }
}
