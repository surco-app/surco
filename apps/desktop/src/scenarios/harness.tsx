import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, renderHook, waitFor } from '@testing-library/react'
import { app } from 'electron'
import type React from 'react'
import { useRef } from 'react'
import { expect } from 'vitest'
import { registerAudioIpc } from '../main/audioIpc'
import { hasCoverSource, prepareProcessedCover } from '../main/cover'
import { addToEngineLibrary } from '../main/engineLibrary'
import { expandPaths } from '../main/expand'
import { createMediaAccess } from '../main/mediaAccess'
import { dirRoots, FolderWatcher } from '../main/watcher'
import { onWatchedFilesChanged } from '../main/watchedFiles'
import { convertAudio } from '../main/ffmpeg'
import { isSameFile, removeRenamedOriginal } from '../main/inplace'
import { flushConversionBatch, type LibraryHost } from '../main/libraryFlushes'
import { beginNmlBatch } from '../main/nmlBatch'
import { configureBackupStore } from '../main/originalKeeper'
import { createOutputReservations } from '../main/outputReservations'
import { runProcessTrack } from '../main/processTrack'
import { beginRekordboxBatch } from '../main/rekordboxBatch'
import { createSessionBackup } from '../main/rekordboxSessionBackup'
import { getSettings, recordConversion, recordStat, replaceSettings } from '../main/settings'
import { createSurcoTrash, type SurcoTrash } from '../main/surcoTrash'
import { createTmpManifest } from '../main/tmpManifest'
import type { Api } from '../preload/api'
import { FindReplaceModal } from '../renderer/src/components/FindReplaceModal'
import { useConfirmFlows } from '../renderer/src/hooks/useConfirmFlows'
import type { ConfirmModal } from '../renderer/src/hooks/useOverlays'
import { useQualityAnalysis } from '../renderer/src/hooks/useQualityAnalysis'
import { useTrackLibrary } from '../renderer/src/hooks/useTrackLibrary'
import { useTrackProcessing } from '../renderer/src/hooks/useTrackProcessing'
import { useTracksView } from '../renderer/src/hooks/useTracksView'
import { acceptReviewPatch } from '../renderer/src/lib/autoMatch'
import { type Destination, fromDestination } from '../renderer/src/lib/destination'
import { createQueryClient } from '../renderer/src/lib/queryClient'
import type { TrackItem } from '../renderer/src/types'
import { trashLimits } from '../shared/backupPolicy'
import { normalizeImportFields } from '../shared/defaults'
import type { ProcessJob, ProcessResult, Release, SearchResult, Settings } from '../shared/types'
import { ipcHandlers } from './electronFake'
import '../renderer/src/i18n'

export type ConflictChoice = 'overwrite' | 'keepBoth' | 'skip'

export interface ScenarioOptions {
  settings: Partial<Settings>
  destination?: Destination
  onConflict?: (outputName: string) => ConflictChoice
}

function invokeMain<T>(channel: string, ...args: unknown[]): Promise<T> {
  const handler = ipcHandlers.get(channel)
  if (!handler) throw new Error(`scenario: main never registered ${channel}`)
  return Promise.resolve(handler({}, ...(args as never[]))) as Promise<T>
}

function processTrackInMain(
  job: ProcessJob,
  reservations: ReturnType<typeof createOutputReservations>,
  options: ScenarioOptions,
  errors: string[],
  appleMusic: string[],
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
    addToAppleMusic: async (target) => {
      appleMusic.push(target)
      return `scenario-pid-${appleMusic.length}`
    },
    updateInAppleMusic: () => Promise.reject(new Error('scenario: Apple Music is not simulated')),
    addToEngineDj: (target, meta, coverPath, replaces) => {
      const s = getSettings()
      return addToEngineLibrary(
        s.engineLibraryDir,
        target,
        meta,
        s.engineDjPlaylist,
        coverPath,
        s.syncEngineDj ? replaces : undefined,
      )
    },
    allowMedia: () => {},
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
    appleMusicEntryLocation: () =>
      Promise.reject(new Error('scenario: Apple Music is not simulated')),
    deleteAppleMusic: () => Promise.reject(new Error('scenario: Apple Music is not simulated')),
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
  }
}

let watcher: FolderWatcher | undefined

function scenarioApi(
  options: ScenarioOptions,
  errors: string[],
  appleMusic: string[],
  flushes: Promise<void>[],
): Api {
  const reservations = createOutputReservations()
  const expandedListeners = new Set<(paths: string[]) => void>()
  const folderListeners = new Set<(root: string, files: string[]) => void>()
  const mediaAccess = createMediaAccess()
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
    expandPaths: async (paths) => {
      const expanded = await expandPaths(paths, (batch) => {
        for (const listener of expandedListeners) listener(batch)
      })
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
    bpm: (path, priority) => invokeMain('audio:bpm', path, priority),
    key: (path, priority) => invokeMain('audio:key', path, priority),
    clicks: (path, priority) => invokeMain('audio:clicks', path, priority),
    waveform: (path, priority) => invokeMain('audio:waveform', path, priority),
    waveformScan: (path) => invokeMain('audio:waveform-scan', path),
    cancelAnalysis: (path) => invokeMain('audio:cancelAnalysis', path),
    onWindowFocus: () => () => {},
    properties: (path) => invokeMain('audio:properties', path),
    beginConversionBatch: () => {
      beginNmlBatch()
      beginRekordboxBatch()
      sessions.rekordbox.reset()
      sessions.engine.reset()
    },
    endConversionBatch: () => {
      flushes.push(flushConversionBatch(libraryHost(errors), sessions))
    },
    processTrack: (job) => processTrackInMain(job, reservations, options, errors, appleMusic),
  }
  return new Proxy(wired as Api, {
    get(target, key) {
      if (key in target) return target[key as keyof Api]
      throw new Error(`scenario: window.api.${String(key)} is not wired`)
    },
  })
}

function searchResultOf(release: Release): SearchResult {
  return { provider: release.provider, id: release.id, title: release.title }
}

export interface Scenario {
  tracks: () => TrackItem[]
  drop: (...paths: string[]) => Promise<void>
  convertAll: (answer?: 'confirm' | 'cancel') => Promise<void>
  prompts: Pick<ConfirmModal, 'title' | 'message'>[]
  patchTrack: (fileName: string, patch: Partial<TrackItem>) => void
  editMeta: (fileName: string, patch: Partial<TrackItem['meta']>) => void
  acceptMatch: (fileName: string, release: Release, position: string) => void
  findAndReplace: (find: string, replace: string, options?: { regex?: boolean }) => string
  rows: () => TrackItem[]
  waitForNewTracks: () => Promise<string[]>
  loadNewTracks: () => Promise<void>
  dismissNewTracks: () => void
  close: () => void
  waitForAnalysis: () => Promise<void>
  trash: SurcoTrash
  errors: string[]
  sentToAppleMusic: string[]
}

export async function openSurco(options: ScenarioOptions): Promise<Scenario> {
  const settings = replaceSettings({
    ...options.settings,
    ...(options.destination && fromDestination(options.destination)),
  })
  const trash = createSurcoTrash(join(app.getPath('userData'), 'trash'), () =>
    trashLimits(getSettings()),
  )
  configureBackupStore(trash, () => getSettings().backupPolicy)
  if (!ipcHandlers.has('audio:meta')) registerAudioIpc(() => {})
  const errors: string[] = []
  const sentToAppleMusic: string[] = []
  const prompts: ConfirmModal[] = []
  const flushes: Promise<void>[] = []
  let running: Promise<void> | undefined
  ;(window as unknown as { api: Api }).api = scenarioApi(options, errors, sentToAppleMusic, flushes)

  const queryClient = createQueryClient()
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  const rowsCache = { current: new Map() }
  const { result } = renderHook(
    () => {
      const analyzeRef = useRef<(tracks: TrackItem[]) => void>(() => {})
      const library = useTrackLibrary({
        setSelection: () => {},
        onForget: () => {},
        onRemove: () => {},
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
      const view = useTracksView(library.tracks, rowsCache, null)
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

  return {
    tracks,
    rows: () => result.current.view.tracksView,
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
      fireEvent.click(modal.getByTestId('find-replace-apply'))
      modal.unmount()
      return preview
    },
    convertAll: async (answer = 'confirm') => {
      running = undefined
      const asked = prompts.length
      act(() => result.current.confirmFlows.askConvertAll(tracks()))
      await waitFor(() => expect(running !== undefined || prompts.length > asked).toBe(true))
      if (!running && answer === 'confirm') act(() => prompts[prompts.length - 1].onConfirm())
      await act(async () => {
        await running
        await Promise.all(flushes)
      })
    },
  }
}
