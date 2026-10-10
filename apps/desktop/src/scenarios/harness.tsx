import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { app } from 'electron'
import type React from 'react'
import { expect } from 'vitest'
import { registerAudioIpc } from '../main/audioIpc'
import { hasCoverSource, prepareProcessedCover } from '../main/cover'
import { expandPaths } from '../main/expand'
import { convertAudio } from '../main/ffmpeg'
import { isSameFile, removeRenamedOriginal } from '../main/inplace'
import { configureBackupStore } from '../main/originalKeeper'
import { createOutputReservations } from '../main/outputReservations'
import { runProcessTrack } from '../main/processTrack'
import { getSettings, recordConversion, recordStat, replaceSettings } from '../main/settings'
import { createSurcoTrash, type SurcoTrash } from '../main/surcoTrash'
import { createTmpManifest } from '../main/tmpManifest'
import type { Api } from '../preload/api'
import { useTrackLibrary } from '../renderer/src/hooks/useTrackLibrary'
import { useTrackProcessing } from '../renderer/src/hooks/useTrackProcessing'
import { acceptReviewPatch } from '../renderer/src/lib/autoMatch'
import { type Destination, fromDestination } from '../renderer/src/lib/destination'
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
    addToEngineDj: () => Promise.reject(new Error('scenario: Engine DJ is not simulated')),
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

function scenarioApi(options: ScenarioOptions, errors: string[], appleMusic: string[]): Api {
  const reservations = createOutputReservations()
  const expandedListeners = new Set<(paths: string[]) => void>()
  const wired: Partial<Api> = {
    platform: process.platform,
    expandPaths: (paths) =>
      expandPaths(paths, (batch) => {
        for (const listener of expandedListeners) listener(batch)
      }),
    onExpandedBatch: (listener) => {
      expandedListeners.add(listener)
      return () => expandedListeners.delete(listener)
    },
    onOpenFiles: () => () => {},
    onFoldersChanged: () => () => {},
    takePendingFiles: async () => [],
    unwatchFolders: async () => {},
    recordStat: (key, by) => recordStat(key, by),
    readMeta: (path) => invokeMain('audio:meta', path),
    beginConversionBatch: () => {},
    endConversionBatch: () => {},
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
  convertAll: () => Promise<void>
  patchTrack: (fileName: string, patch: Partial<TrackItem>) => void
  acceptMatch: (fileName: string, release: Release, position: string) => void
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
  ;(window as unknown as { api: Api }).api = scenarioApi(options, errors, sentToAppleMusic)

  const queryClient = new QueryClient()
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  const { result } = renderHook(
    () => {
      const library = useTrackLibrary({
        setSelection: () => {},
        onForget: () => {},
        onRemove: () => {},
        onClear: () => {},
        onMetaLoaded: () => {},
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
      return { library, processing }
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
    trash,
    errors,
    sentToAppleMusic,
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
    convertAll: async () => {
      await act(async () => {
        await result.current.processing.processAll(tracks())
      })
    },
  }
}
