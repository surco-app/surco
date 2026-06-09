// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Settings, TrackMetadata } from '../../../shared/types'
import type { TrackItem } from '../types'
import '../i18n'
import { useTrackProcessing } from './useTrackProcessing'

function meta(over: Partial<TrackMetadata> = {}): TrackMetadata {
  return {
    title: 'Title',
    artist: 'Artist',
    album: '',
    albumArtist: '',
    year: '',
    genre: '',
    grouping: '',
    comment: '',
    trackNumber: '',
    discNumber: '',
    bpm: '',
    key: '',
    publisher: '',
    catalogNumber: '',
    remixArtist: '',
    ...over,
  }
}

function track(
  over: Partial<Omit<TrackItem, 'meta'>> & { id: string; meta?: TrackMetadata },
): TrackItem {
  return {
    inputPath: `/m/${over.id}.wav`,
    fileName: `${over.id}.wav`,
    listLabel: `${over.id}.wav`,
    query: '',
    status: 'idle',
    ...over,
    meta: over.meta ?? meta(),
  }
}

function setApi(over: Record<string, unknown>): void {
  ;(window as unknown as { api: unknown }).api = over
}

afterEach(() => vi.restoreAllMocks())

describe('useTrackProcessing', () => {
  // The happy path: a track with its required tags converts, the row is marked
  // processing then written back from the result, and the outcome counts as converted.
  it('converts a valid track and reports it converted', async () => {
    setApi({ processTrack: vi.fn().mockResolvedValue({ outputPath: '/out/a.aiff' }) })
    const updateTrack = vi.fn()
    const { result } = renderHook(() =>
      useTrackProcessing({
        tracks: [track({ id: 'a' })],
        settings: null,
        updateTrack,
        isPro: true,
        onUpgrade: vi.fn(),
        onLicenseChanged: vi.fn(),
      }),
    )
    let outcome: string | undefined
    await act(async () => {
      outcome = await result.current.processOne('a')
    })
    expect(outcome).toBe('converted')
    expect(updateTrack).toHaveBeenCalledWith('a', expect.objectContaining({ status: 'processing' }))
  })

  // The convert gate must hold here too: a track missing a required tag never reaches
  // ffmpeg — it's flagged in error instead, so the shortcut can't start a doomed run.
  it('refuses a track missing a required field without converting', async () => {
    const processTrack = vi.fn()
    setApi({ processTrack })
    const updateTrack = vi.fn()
    const { result } = renderHook(() =>
      useTrackProcessing({
        tracks: [track({ id: 'a', meta: meta({ artist: '' }) })],
        settings: null,
        updateTrack,
        isPro: true,
        onUpgrade: vi.fn(),
        onLicenseChanged: vi.fn(),
      }),
    )
    let outcome: string | undefined
    await act(async () => {
      outcome = await result.current.processOne('a')
    })
    expect(outcome).toBe('failed')
    expect(processTrack).not.toHaveBeenCalled()
    expect(updateTrack).toHaveBeenCalledWith('a', expect.objectContaining({ status: 'error' }))
  })

  // A main-process failure surfaces on the row rather than throwing, so one bad file
  // never takes the app down mid-convert.
  it('surfaces a conversion error on the track', async () => {
    setApi({ processTrack: vi.fn().mockRejectedValue(new Error('disk full')) })
    const updateTrack = vi.fn()
    const { result } = renderHook(() =>
      useTrackProcessing({
        tracks: [track({ id: 'a' })],
        settings: null,
        updateTrack,
        isPro: true,
        onUpgrade: vi.fn(),
        onLicenseChanged: vi.fn(),
      }),
    )
    let outcome: string | undefined
    await act(async () => {
      outcome = await result.current.processOne('a')
    })
    expect(outcome).toBe('failed')
    expect(updateTrack).toHaveBeenLastCalledWith(
      'a',
      expect.objectContaining({ status: 'error', error: 'disk full' }),
    )
  })

  // Convert-all runs every eligible track and reports the run's tally, which is what
  // the toolbar's "3 converted" summary reads from.
  it('converts every eligible track and summarizes the run', async () => {
    setApi({ processTrack: vi.fn().mockResolvedValue({ outputPath: '/out/x.aiff' }) })
    const updateTrack = vi.fn()
    const tracks = [track({ id: 'a' }), track({ id: 'b' })]
    const { result } = renderHook(() =>
      useTrackProcessing({
        tracks,
        settings: null,
        updateTrack,
        isPro: true,
        onUpgrade: vi.fn(),
        onLicenseChanged: vi.fn(),
      }),
    )
    await act(async () => {
      await result.current.processAll(tracks)
    })
    await waitFor(() =>
      expect(result.current.batchSummary).toEqual({ converted: 2, skipped: 0, failed: 0 }),
    )
  })

  // A per-track custom name (set via rename/regenerate) is normally honored, so the
  // export lands under the user's chosen file name rather than the source's.
  it('honors a custom output name when not overwriting', async () => {
    const processTrack = vi.fn().mockResolvedValue({ outputPath: '/out/custom name.aiff' })
    setApi({ processTrack })
    const { result } = renderHook(() =>
      useTrackProcessing({
        tracks: [track({ id: 'a', outputName: 'custom name' })],
        settings: { overwriteOriginal: false } as unknown as Settings,
        updateTrack: vi.fn(),
        isPro: true,
        onUpgrade: vi.fn(),
        onLicenseChanged: vi.fn(),
      }),
    )
    await act(async () => {
      await result.current.processOne('a')
    })
    expect(processTrack).toHaveBeenCalledWith(expect.objectContaining({ outputName: 'custom name' }))
  })

  // Overwrite rewrites the source itself, so the export must target the original file
  // name even if a stale custom outputName lingers from before the setting was enabled —
  // otherwise the rewrite would land on a differently-named file, not the source.
  it('pins the export name to the original file name in overwrite mode', async () => {
    const processTrack = vi.fn().mockResolvedValue({ outputPath: '/m/a.wav', inPlace: true })
    setApi({ processTrack })
    const { result } = renderHook(() =>
      useTrackProcessing({
        tracks: [track({ id: 'a', outputName: 'custom name' })],
        settings: { overwriteOriginal: true } as unknown as Settings,
        updateTrack: vi.fn(),
        isPro: true,
        onUpgrade: vi.fn(),
        onLicenseChanged: vi.fn(),
      }),
    )
    await act(async () => {
      await result.current.processOne('a')
    })
    expect(processTrack).toHaveBeenCalledWith(expect.objectContaining({ outputName: 'a.wav' }))
  })

  // "Convert all" is a Pro feature: for a free user it must not touch the conversion
  // pipeline at all — it opens the upgrade screen instead, so no track is spent.
  it('blocks Convert all behind Pro and opens the upgrade screen', async () => {
    const processTrack = vi.fn()
    setApi({ processTrack })
    const onUpgrade = vi.fn()
    const tracks = [track({ id: 'a' }), track({ id: 'b' })]
    const { result } = renderHook(() =>
      useTrackProcessing({
        tracks,
        settings: null,
        updateTrack: vi.fn(),
        isPro: false,
        onUpgrade,
        onLicenseChanged: vi.fn(),
      }),
    )
    await act(async () => {
      await result.current.processAll(tracks)
    })
    expect(onUpgrade).toHaveBeenCalledWith('batch')
    expect(processTrack).not.toHaveBeenCalled()
  })

  // When the main process reports the free monthly limit was hit, nothing was written:
  // the row stays idle (still convertible) and the upgrade screen is surfaced.
  it('surfaces the upgrade screen when the free limit is reached', async () => {
    setApi({
      processTrack: vi
        .fn()
        .mockResolvedValue({ outputPath: '', inPlace: false, limitReached: true }),
    })
    const updateTrack = vi.fn()
    const onUpgrade = vi.fn()
    const { result } = renderHook(() =>
      useTrackProcessing({
        tracks: [track({ id: 'a' })],
        settings: null,
        updateTrack,
        isPro: true,
        onUpgrade,
        onLicenseChanged: vi.fn(),
      }),
    )
    let outcome: string | undefined
    await act(async () => {
      outcome = await result.current.processOne('a')
    })
    expect(outcome).toBe('skipped')
    expect(onUpgrade).toHaveBeenCalledWith('limit')
    expect(updateTrack).toHaveBeenLastCalledWith('a', expect.objectContaining({ status: 'idle' }))
  })
})
