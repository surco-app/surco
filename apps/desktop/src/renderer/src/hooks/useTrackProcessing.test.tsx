// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type React from 'react'
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

// The hook evicts probe caches on in-place exports, so every render needs a
// QueryClient in scope.
function withClient(
  client = new QueryClient(),
): (props: { children: React.ReactNode }) => React.JSX.Element {
  return ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

afterEach(() => vi.restoreAllMocks())

describe('useTrackProcessing', () => {
  // The happy path: a track with its required tags converts, the row is marked
  // processing then written back from the result, and the outcome counts as converted.
  it('converts a valid track and reports it converted', async () => {
    setApi({ processTrack: vi.fn().mockResolvedValue({ outputPath: '/out/a.aiff' }) })
    const updateTrack = vi.fn()
    const { result } = renderHook(
      () =>
        useTrackProcessing({
          tracks: [track({ id: 'a' })],
          settings: null,
          updateTrack,
        }),
      { wrapper: withClient() },
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
    const { result } = renderHook(
      () =>
        useTrackProcessing({
          tracks: [track({ id: 'a', meta: meta({ artist: '' }) })],
          settings: null,
          updateTrack,
        }),
      { wrapper: withClient() },
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
    const { result } = renderHook(
      () =>
        useTrackProcessing({
          tracks: [track({ id: 'a' })],
          settings: null,
          updateTrack,
        }),
      { wrapper: withClient() },
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
    const { result } = renderHook(
      () =>
        useTrackProcessing({
          tracks,
          settings: null,
          updateTrack,
        }),
      { wrapper: withClient() },
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
    const { result } = renderHook(
      () =>
        useTrackProcessing({
          tracks: [track({ id: 'a', outputName: 'custom name' })],
          settings: { overwriteOriginal: false } as unknown as Settings,
          updateTrack: vi.fn(),
        }),
      { wrapper: withClient() },
    )
    await act(async () => {
      await result.current.processOne('a')
    })
    expect(processTrack).toHaveBeenCalledWith(
      expect.objectContaining({ outputName: 'custom name' }),
    )
  })

  // Overwrite rewrites the source itself, so the export must target the original file
  // name even if a stale custom outputName lingers from before the setting was enabled —
  // otherwise the rewrite would land on a differently-named file, not the source.
  it('pins the export name to the original file name in overwrite mode', async () => {
    const processTrack = vi.fn().mockResolvedValue({ outputPath: '/m/a.wav', inPlace: true })
    setApi({ processTrack })
    const { result } = renderHook(
      () =>
        useTrackProcessing({
          tracks: [track({ id: 'a', outputName: 'custom name' })],
          settings: { overwriteOriginal: true } as unknown as Settings,
          updateTrack: vi.fn(),
        }),
      { wrapper: withClient() },
    )
    await act(async () => {
      await result.current.processOne('a')
    })
    expect(processTrack).toHaveBeenCalledWith(expect.objectContaining({ outputName: 'a.wav' }))
  })

  // The list stays editable while a batch runs, so each track must be read at the
  // moment it converts — not from the snapshot taken when the batch started. An edit
  // made while an earlier track converts has to land in the file that gets written.
  it('converts each track from live state, not the snapshot from the batch start', async () => {
    let releaseFirst: (v: { outputPath: string }) => void = () => {}
    const processTrack = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseFirst = resolve
          }),
      )
      .mockResolvedValue({ outputPath: '/out/b.aiff' })
    setApi({ processTrack })
    const initial = [track({ id: 'a' }), track({ id: 'b' })]
    const { result, rerender } = renderHook(
      (props: { tracks: TrackItem[] }) =>
        useTrackProcessing({ tracks: props.tracks, settings: null, updateTrack: vi.fn() }),
      { initialProps: { tracks: initial }, wrapper: withClient() },
    )
    let run: Promise<void> = Promise.resolve()
    act(() => {
      run = result.current.processAll(initial)
    })
    await waitFor(() => expect(processTrack).toHaveBeenCalledTimes(1))
    rerender({ tracks: [initial[0], track({ id: 'b', meta: meta({ title: 'Edited' }) })] })
    releaseFirst({ outputPath: '/out/a.aiff' })
    await act(async () => {
      await run
    })
    expect(processTrack).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'b', meta: expect.objectContaining({ title: 'Edited' }) }),
    )
  })

  // A track removed while the batch runs was a user decision, not a conversion
  // failure: reporting "1 failed" sends the user hunting for an error row that
  // doesn't exist.
  it('counts a track removed mid-batch as skipped, not failed', async () => {
    let releaseFirst: (v: { outputPath: string }) => void = () => {}
    const processTrack = vi.fn().mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseFirst = resolve
        }),
    )
    setApi({ processTrack })
    const initial = [track({ id: 'a' }), track({ id: 'b' })]
    const { result, rerender } = renderHook(
      (props: { tracks: TrackItem[] }) =>
        useTrackProcessing({ tracks: props.tracks, settings: null, updateTrack: vi.fn() }),
      { initialProps: { tracks: initial }, wrapper: withClient() },
    )
    let run: Promise<void> = Promise.resolve()
    act(() => {
      run = result.current.processAll(initial)
    })
    await waitFor(() => expect(processTrack).toHaveBeenCalledTimes(1))
    rerender({ tracks: [initial[0]] })
    releaseFirst({ outputPath: '/out/a.aiff' })
    await act(async () => {
      await run
    })
    expect(result.current.batchSummary).toEqual({ converted: 1, skipped: 1, failed: 0 })
  })

  // An in-place export rewrites the source file — re-encoded, normalized, re-tagged —
  // so the session-long probe caches for that path now describe a file that no longer
  // exists. Without eviction the loudness/properties/spectrum readouts keep showing the
  // pre-rewrite facts, in exactly the mode where the user just changed the file.
  it('evicts the rewritten path’s cached probes after an in-place export', async () => {
    setApi({ processTrack: vi.fn().mockResolvedValue({ outputPath: '/m/a.wav', inPlace: true }) })
    const client = new QueryClient()
    client.setQueryData(['loudness', '/m/a.wav'], { integrated: -9 })
    client.setQueryData(['spectrogram', '/m/a.wav'], { image: 'x' })
    client.setQueryData(['loudness', '/m/b.wav'], { integrated: -12 })
    const { result } = renderHook(
      () =>
        useTrackProcessing({ tracks: [track({ id: 'a' })], settings: null, updateTrack: vi.fn() }),
      { wrapper: withClient(client) },
    )
    await act(async () => {
      await result.current.processOne('a')
    })
    expect(client.getQueryData(['loudness', '/m/a.wav'])).toBeUndefined()
    expect(client.getQueryData(['spectrogram', '/m/a.wav'])).toBeUndefined()
    expect(client.getQueryData(['loudness', '/m/b.wav'])).toBeDefined()
  })
})
