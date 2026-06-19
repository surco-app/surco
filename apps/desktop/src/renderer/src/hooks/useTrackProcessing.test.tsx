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

  // Normalization was requested but its measurement failed, so the file converted at its
  // original level. The user must be told, named by the track, rather than the skip
  // passing silently and the file landing un-normalized without warning.
  it('reports the track name when normalization was skipped', async () => {
    setApi({
      processTrack: vi.fn().mockResolvedValue({ outputPath: '/out/a.aiff', normalizeSkipped: true }),
    })
    const onNormalizeSkipped = vi.fn()
    const { result } = renderHook(
      () =>
        useTrackProcessing({
          tracks: [track({ id: 'a' })],
          settings: null,
          updateTrack: vi.fn(),
          onNormalizeSkipped,
        }),
      { wrapper: withClient() },
    )
    await act(async () => {
      await result.current.processOne('a')
    })
    expect(onNormalizeSkipped).toHaveBeenCalledWith('a.wav')
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

  // The donate nudge rides the moment of value, and a convert-all is one moment no
  // matter how many tracks it spans — firing per track would ask for support thirty
  // times in a thirty-track run, the exact nagware the nudge is built to avoid.
  it('fires onConversion once per run, not once per converted track', async () => {
    setApi({ processTrack: vi.fn().mockResolvedValue({ outputPath: '/out/x.aiff' }) })
    const onConversion = vi.fn()
    const tracks = [track({ id: 'a' }), track({ id: 'b' })]
    const { result } = renderHook(
      () => useTrackProcessing({ tracks, settings: null, updateTrack: vi.fn(), onConversion }),
      { wrapper: withClient() },
    )
    await act(async () => {
      await result.current.processAll(tracks)
    })
    expect(onConversion).toHaveBeenCalledTimes(1)
  })

  // A run that wrote nothing (every track skipped or failed) is no moment of value:
  // asking for a donation right after it produced no result reads as nagware, so the
  // nudge must stay silent unless at least one track actually converted.
  it('does not fire onConversion when a run converted nothing', async () => {
    setApi({ processTrack: vi.fn().mockResolvedValue({ outputPath: '', skipped: true }) })
    const onConversion = vi.fn()
    const tracks = [track({ id: 'a' })]
    const { result } = renderHook(
      () => useTrackProcessing({ tracks, settings: null, updateTrack: vi.fn(), onConversion }),
      { wrapper: withClient() },
    )
    await act(async () => {
      await result.current.processAll(tracks)
    })
    expect(onConversion).not.toHaveBeenCalled()
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

  // The multi-select Apple Music sweep used to be an uninterruptible serial loop with
  // no progress: a large selection of slow AppleScript adds had no escape hatch. It
  // now runs through the batch state, so the same cancel that stops a convert stops it.
  it('cancels the Apple Music sweep between tracks', async () => {
    let releaseFirst: () => void = () => {}
    const addToAppleMusic = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((res) => {
            releaseFirst = res
          }),
      )
      .mockResolvedValue(undefined)
    setApi({ addToAppleMusic })
    const tracks = [
      track({ id: 'a', outputPath: '/out/a.aiff' }),
      track({ id: 'b', outputPath: '/out/b.aiff' }),
    ]
    const { result } = renderHook(
      () => useTrackProcessing({ tracks, settings: null, updateTrack: vi.fn() }),
      { wrapper: withClient() },
    )
    let run: Promise<void> = Promise.resolve()
    act(() => {
      run = result.current.addAllToAppleMusic(['a', 'b'])
    })
    await waitFor(() => expect(addToAppleMusic).toHaveBeenCalledTimes(1))

    act(() => result.current.cancelBatch())
    releaseFirst()
    await act(async () => {
      await run
    })
    expect(addToAppleMusic).toHaveBeenCalledTimes(1)
  })

  it('hands the stored persistent ID to the conversion, so the automatic Apple Music step syncs the existing library copy instead of importing a duplicate', async () => {
    const processTrack = vi.fn().mockResolvedValue({ outputPath: '/out/a.aiff' })
    setApi({ processTrack })
    const { result } = renderHook(
      () =>
        useTrackProcessing({
          tracks: [track({ id: 'a', musicPersistentId: 'ABCD1234' })],
          settings: null,
          updateTrack: vi.fn(),
        }),
      { wrapper: withClient() },
    )
    await act(() => result.current.processOne('a'))
    expect(processTrack).toHaveBeenCalledWith(
      expect.objectContaining({ musicPersistentId: 'ABCD1234' }),
    )
  })

  it('stores the persistent ID a manual add returns, the handle every later sync and reveal needs to find this exact library copy', async () => {
    setApi({ addToAppleMusic: vi.fn().mockResolvedValue('ABCD1234') })
    const updateTrack = vi.fn()
    const { result } = renderHook(
      () =>
        useTrackProcessing({
          tracks: [track({ id: 'a', outputPath: '/out/a.aiff' })],
          settings: null,
          updateTrack,
        }),
      { wrapper: withClient() },
    )
    await act(() => result.current.addTrackToAppleMusic('a'))
    expect(updateTrack).toHaveBeenLastCalledWith('a', {
      musicStatus: 'added',
      musicPersistentId: 'ABCD1234',
    })
  })

  it('syncs through updateAppleMusic when the track already has a library copy, passing the output file as the re-add fallback for a copy the user deleted', async () => {
    const updateAppleMusic = vi.fn().mockResolvedValue('ABCD1234')
    const addToAppleMusic = vi.fn()
    setApi({ updateAppleMusic, addToAppleMusic })
    const { result } = renderHook(
      () =>
        useTrackProcessing({
          tracks: [track({ id: 'a', outputPath: '/out/a.aiff', musicPersistentId: 'ABCD1234' })],
          settings: null,
          updateTrack: vi.fn(),
        }),
      { wrapper: withClient() },
    )
    await act(() => result.current.addTrackToAppleMusic('a'))
    expect(updateAppleMusic).toHaveBeenCalledWith(
      expect.objectContaining({ persistentId: 'ABCD1234', outputPath: '/out/a.aiff' }),
    )
    expect(addToAppleMusic).not.toHaveBeenCalled()
  })

  // The user deleted the library copy in Music: updateAppleMusic finds nothing (resolves
  // undefined), so the track must be re-added from its output file rather than falsely
  // reported as synced. Without the fallback it would read "added" while gone from Music.
  it('re-adds through addToAppleMusic when the update finds the library copy gone', async () => {
    const updateAppleMusic = vi.fn().mockResolvedValue(undefined)
    const addToAppleMusic = vi.fn().mockResolvedValue('NEW5678')
    setApi({ updateAppleMusic, addToAppleMusic })
    const updateTrack = vi.fn()
    const { result } = renderHook(
      () =>
        useTrackProcessing({
          tracks: [track({ id: 'a', outputPath: '/out/a.aiff', musicPersistentId: 'ABCD1234' })],
          settings: null,
          updateTrack,
        }),
      { wrapper: withClient() },
    )
    await act(() => result.current.addTrackToAppleMusic('a'))
    expect(addToAppleMusic).toHaveBeenCalledWith(
      expect.objectContaining({ outputPath: '/out/a.aiff' }),
    )
    expect(updateTrack).toHaveBeenCalledWith(
      'a',
      expect.objectContaining({ musicStatus: 'added', musicPersistentId: 'NEW5678' }),
    )
  })

  it('syncs a track that kept no output file ("Apple Music only" mode) — the update needs no file, only the persistent ID', async () => {
    const updateAppleMusic = vi.fn().mockResolvedValue('ABCD1234')
    setApi({ updateAppleMusic })
    const { result } = renderHook(
      () =>
        useTrackProcessing({
          tracks: [track({ id: 'a', musicPersistentId: 'ABCD1234' })],
          settings: null,
          updateTrack: vi.fn(),
        }),
      { wrapper: withClient() },
    )
    await act(() => result.current.addTrackToAppleMusic('a'))
    expect(updateAppleMusic).toHaveBeenCalledWith(
      expect.objectContaining({ persistentId: 'ABCD1234' }),
    )
  })

  // The renderer's copy of a file's embedded art is a display thumbnail; the convert
  // job must name the source file so main embeds the original at full resolution
  // instead of permanently downscaling the user's artwork.
  it('takes the file’s own art from the source, never the renderer thumbnail', async () => {
    const processTrack = vi.fn().mockResolvedValue({ outputPath: '/out/a.aiff' })
    setApi({ processTrack })
    const thumb = 'data:image/jpeg;base64,thumb'
    const { result } = renderHook(
      () =>
        useTrackProcessing({
          tracks: [track({ id: 'a', coverUrl: thumb, embeddedCover: thumb })],
          settings: null,
          updateTrack: vi.fn(),
        }),
      { wrapper: withClient() },
    )
    await act(async () => {
      await result.current.processOne('a')
    })
    const job = processTrack.mock.calls[0][0]
    expect(job.coverFromFile).toBe('/m/a.wav')
    expect(job.coverUrl).toBeUndefined()
    expect(job.coverPath).toBeUndefined()
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
