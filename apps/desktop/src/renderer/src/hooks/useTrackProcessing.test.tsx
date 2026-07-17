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
  // beginConversionBatch fires at the top of every processAll run (it resets main's
  // conflict-decision memory), so stub it by default; a test that cares can still override.
  ;(window as unknown as { api: unknown }).api = { beginConversionBatch: vi.fn(), ...over }
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

  // The trim rides the track (persisted, per-track), not a convert-time override:
  // every entry point — single convert, ⌘⏎, convert all — must send the staged
  // range without knowing it exists.
  it('sends the track’s staged silence trim with the job', async () => {
    const processTrack = vi.fn().mockResolvedValue({ outputPath: '/out/a.aiff' })
    setApi({ processTrack })
    const { result } = renderHook(
      () =>
        useTrackProcessing({
          tracks: [track({ id: 'a', trim: { startSec: 3.2, endSec: 200 } })],
          settings: null,
          updateTrack: vi.fn(),
        }),
      { wrapper: withClient() },
    )
    await act(async () => {
      await result.current.processOne('a')
    })
    expect(processTrack).toHaveBeenCalledWith(
      expect.objectContaining({ trim: { startSec: 3.2, endSec: 200 } }),
    )
  })

  // Normalization was requested but its measurement failed, so the file converted at its
  // original level. The user must be told, named by the track, rather than the skip
  // passing silently and the file landing un-normalized without warning.
  it('reports the track name when normalization was skipped', async () => {
    setApi({
      processTrack: vi
        .fn()
        .mockResolvedValue({ outputPath: '/out/a.aiff', normalizeSkipped: true }),
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

  // A track already mid-conversion must never convert twice at once: the user can
  // hand-convert (or ⌘⏎) a still-idle track while a running batch has it queued, and
  // when the batch later reaches it both jobs would write the same output path.
  // Whoever started first owns the conversion; the second call counts as skipped.
  it('skips a track that is already converting instead of starting a second job', async () => {
    const processTrack = vi.fn()
    setApi({ processTrack })
    const updateTrack = vi.fn()
    const { result } = renderHook(
      () =>
        useTrackProcessing({
          tracks: [track({ id: 'a', status: 'processing' })],
          settings: null,
          updateTrack,
        }),
      { wrapper: withClient() },
    )
    let outcome: string | undefined
    await act(async () => {
      outcome = await result.current.processOne('a')
    })
    expect(outcome).toBe('skipped')
    expect(processTrack).not.toHaveBeenCalled()
    expect(updateTrack).not.toHaveBeenCalled()
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

  // Electron wraps a main-process throw in "Error invoking remote method '…': Error: …".
  // That plumbing prefix means nothing to the user and eats the row's visible width, so
  // the stored error is the clean message — and the error callback (the toast) gets it too.
  it('strips the IPC wrapper from the error and raises the error callback', async () => {
    setApi({
      processTrack: vi
        .fn()
        .mockRejectedValue(
          new Error(
            "Error invoking remote method 'process:track': Error: Cierra Engine DJ antes de convertir: tiene la biblioteca abierta.",
          ),
        ),
    })
    const updateTrack = vi.fn()
    const onProcessError = vi.fn()
    const { result } = renderHook(
      () =>
        useTrackProcessing({
          tracks: [track({ id: 'a' })],
          settings: null,
          updateTrack,
          onProcessError,
        }),
      { wrapper: withClient() },
    )
    await act(async () => {
      await result.current.processOne('a')
    })
    const clean = 'Cierra Engine DJ antes de convertir: tiene la biblioteca abierta.'
    expect(updateTrack).toHaveBeenLastCalledWith(
      'a',
      expect.objectContaining({ status: 'error', error: clean }),
    )
    expect(onProcessError).toHaveBeenCalledWith(clean)
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

  // The whole point of the bulk run: several conversions must be in flight at once,
  // not one-at-a-time. A convert that never resolves on its own lets us observe how many
  // processTrack calls overlap — a sequential loop would only ever reach 1.
  it('runs conversions concurrently, not strictly one after another', async () => {
    let inFlight = 0
    let peak = 0
    const releases: Array<() => void> = []
    const processTrack = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          inFlight++
          peak = Math.max(peak, inFlight)
          releases.push(() => {
            inFlight--
            resolve({ outputPath: '/out/x.aiff' })
          })
        }),
    )
    setApi({ processTrack })
    const tracks = [track({ id: 'a' }), track({ id: 'b' }), track({ id: 'c' }), track({ id: 'd' })]
    const { result } = renderHook(
      () => useTrackProcessing({ tracks, settings: null, updateTrack: vi.fn(), concurrency: 4 }),
      { wrapper: withClient() },
    )
    let done: Promise<void>
    await act(async () => {
      done = result.current.processAll(tracks)
      // Let the pool spin up its workers before anything resolves.
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(peak).toBeGreaterThan(1)
    await act(async () => {
      for (const release of releases) release()
      // Draining the queue may enqueue more once slots free; release those too.
      await new Promise((r) => setTimeout(r, 0))
      for (const release of releases) release()
      await done
    })
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

  // The split-button's one-shot destination pick must reach main as the job's own
  // facets: main falls back to Settings for any facet the job omits, so a pick that
  // sent only the changed flag would still convert half to the old destination.
  it('expands a destination override into the full facet set on the job', async () => {
    const processTrack = vi.fn().mockResolvedValue({ outputPath: '/out/a.aiff' })
    setApi({ processTrack })
    const { result } = renderHook(
      () =>
        useTrackProcessing({
          tracks: [track({ id: 'a' })],
          settings: { addToAppleMusic: true, keepOutputCopy: false } as unknown as Settings,
          updateTrack: vi.fn(),
        }),
      { wrapper: withClient() },
    )
    await act(async () => {
      await result.current.processOne('a', undefined, undefined, undefined, undefined, 'engineDj')
    })
    expect(processTrack).toHaveBeenCalledWith(
      expect.objectContaining({
        addToAppleMusic: false,
        keepOutputCopy: true,
        addToEngineDj: true,
        convertBesideOriginal: false,
        overwriteOriginal: false,
      }),
    )
  })

  // Overriding to overwrite must behave exactly like the setting: the export lands
  // back on the source's own name, not on a lingering custom outputName.
  it('pins the export name to the original when the destination override is overwrite', async () => {
    const processTrack = vi.fn().mockResolvedValue({ outputPath: '/m/a.wav', inPlace: true })
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
      await result.current.processOne('a', undefined, undefined, undefined, undefined, 'overwrite')
    })
    expect(processTrack).toHaveBeenCalledWith(
      expect.objectContaining({ outputName: 'a.wav', overwriteOriginal: true }),
    )
  })

  // A batch run with a destination override pins it for every queued track — including
  // overriding AWAY from configured overwrite: the pick said "new files this time", so
  // no track in the run may rewrite its source.
  it('pins the destination override across a batch over the overwrite setting', async () => {
    const processTrack = vi.fn().mockResolvedValue({ outputPath: '/out/x.aiff' })
    setApi({ processTrack })
    const tracks = [track({ id: 'a' }), track({ id: 'b' })]
    const { result } = renderHook(
      () =>
        useTrackProcessing({
          tracks,
          settings: { overwriteOriginal: true } as unknown as Settings,
          updateTrack: vi.fn(),
          concurrency: 1,
        }),
      { wrapper: withClient() },
    )
    await act(async () => {
      await result.current.processAll(tracks, undefined, undefined, 'folder')
    })
    expect(processTrack).toHaveBeenCalledTimes(2)
    for (const call of processTrack.mock.calls) {
      expect(call[0]).toMatchObject({ overwriteOriginal: false, convertBesideOriginal: false })
    }
  })

  // With auto-apply on, a track the user never renamed must still export under the pattern,
  // not the source file name — that's the whole point of the setting (no button press needed).
  it('derives the export name from the pattern when auto-apply is on and no manual name was set', async () => {
    const processTrack = vi.fn().mockResolvedValue({ outputPath: '/out/Artist - Title.aiff' })
    setApi({ processTrack })
    const { result } = renderHook(
      () =>
        useTrackProcessing({
          tracks: [track({ id: 'a' })],
          settings: {
            overwriteOriginal: false,
            autoApplyFilename: true,
            filenameFormat: '{artist} - {title}',
          } as unknown as Settings,
          updateTrack: vi.fn(),
        }),
      { wrapper: withClient() },
    )
    await act(async () => {
      await result.current.processOne('a')
    })
    expect(processTrack).toHaveBeenCalledWith(
      expect.objectContaining({ outputName: 'Artist - Title' }),
    )
  })

  // Auto-apply only fills the gap when the user hasn't chosen a name: a manual outputName
  // (rename/edit) must still win, or the setting would silently overwrite deliberate names.
  it('keeps a manual output name over the pattern when auto-apply is on', async () => {
    const processTrack = vi.fn().mockResolvedValue({ outputPath: '/out/custom name.aiff' })
    setApi({ processTrack })
    const { result } = renderHook(
      () =>
        useTrackProcessing({
          tracks: [track({ id: 'a', outputName: 'custom name' })],
          settings: {
            overwriteOriginal: false,
            autoApplyFilename: true,
            filenameFormat: '{artist} - {title}',
          } as unknown as Settings,
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
    // concurrency: 1 so 'b' is still queued (not yet started) while 'a' converts — the
    // live-state guarantee is about a track picked up from current state when its turn
    // comes, which is exactly the not-yet-started case a concurrent run still honors.
    const { result, rerender } = renderHook(
      (props: { tracks: TrackItem[] }) =>
        useTrackProcessing({
          tracks: props.tracks,
          settings: null,
          updateTrack: vi.fn(),
          concurrency: 1,
        }),
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

  // cancelBatchRef alone only stops tracks not yet started — a stalled network
  // mount would leave an already-running conversion (and the whole batch) stuck
  // forever. cancelBatch must also ask main to kill it by job id.
  it('asks main to cancel every job in the run when cancelBatch fires mid-batch', async () => {
    let releaseFirst: (v: { outputPath: string }) => void = () => {}
    const processTrack = vi.fn().mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseFirst = resolve
        }),
    )
    const cancelJob = vi.fn()
    setApi({ processTrack, cancelJob })
    // concurrency: 1 so 'b' is still queued (not yet started, no processTrack call
    // for it) while 'a' is the one in flight — cancelBatch must still ask main to
    // cancel both, since it can't tell from the renderer side which has started.
    const tracks = [track({ id: 'a' }), track({ id: 'b' })]
    const { result } = renderHook(
      () => useTrackProcessing({ tracks, settings: null, updateTrack: vi.fn(), concurrency: 1 }),
      { wrapper: withClient() },
    )
    let run: Promise<void> = Promise.resolve()
    act(() => {
      run = result.current.processAll(tracks)
    })
    await waitFor(() => expect(processTrack).toHaveBeenCalledTimes(1))

    act(() => result.current.cancelBatch())
    expect(cancelJob).toHaveBeenCalledWith('a')
    expect(cancelJob).toHaveBeenCalledWith('b')

    releaseFirst({ outputPath: '/out/a.aiff' })
    await act(async () => {
      await run
    })
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
    // concurrency: 1 so 'b' hasn't started when it's removed — the removal must turn it
    // into a skip rather than a conversion of a track the user has taken off the list.
    const { result, rerender } = renderHook(
      (props: { tracks: TrackItem[] }) =>
        useTrackProcessing({
          tracks: props.tracks,
          settings: null,
          updateTrack: vi.fn(),
          concurrency: 1,
        }),
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
    setApi({ addToAppleMusic, cancelJob: vi.fn() })
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

  // The convert summary banner auto-dismisses after a few seconds; starting an Apple
  // Music sweep before it does must clear it, or the stale "N converted" banner overlaps
  // the sweep's own progress UI.
  it('clears a lingering convert summary when the Apple Music sweep starts', async () => {
    setApi({
      processTrack: vi.fn().mockResolvedValue({ outputPath: '/out/a.aiff' }),
      addToAppleMusic: vi.fn().mockResolvedValue(undefined),
    })
    const tracks = [track({ id: 'a', outputPath: '/out/a.aiff' })]
    const { result } = renderHook(
      () => useTrackProcessing({ tracks, settings: null, updateTrack: vi.fn() }),
      { wrapper: withClient() },
    )
    await act(async () => {
      await result.current.processAll(tracks)
    })
    await waitFor(() => expect(result.current.batchSummary).not.toBeNull())
    await act(async () => {
      await result.current.addAllToAppleMusic(['a'])
    })
    expect(result.current.batchSummary).toBeNull()
  })

  // A clean run's "N converted" banner is a transient confirmation, so it auto-dismisses a
  // few seconds later rather than lingering over the next bit of work.
  it('auto-dismisses a summary with no failures after a few seconds', async () => {
    vi.useFakeTimers()
    try {
      setApi({ processTrack: vi.fn().mockResolvedValue({ outputPath: '/out/a.aiff' }) })
      const tracks = [track({ id: 'a' })]
      const { result } = renderHook(
        () => useTrackProcessing({ tracks, settings: null, updateTrack: vi.fn() }),
        { wrapper: withClient() },
      )
      await act(async () => {
        await result.current.processAll(tracks)
      })
      expect(result.current.batchSummary).toEqual({ converted: 1, skipped: 0, failed: 0 })
      await act(async () => {
        vi.advanceTimersByTime(6000)
      })
      expect(result.current.batchSummary).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  // Failures are the one outcome worth reading after the fact: the failed rows stay flagged
  // in the list, but the aggregate "N failed" count must not vanish on the auto-dismiss timer
  // before the user has had a chance to take it in. A run with any failure keeps its summary.
  it('keeps a summary that reports failures past the auto-dismiss delay', async () => {
    vi.useFakeTimers()
    try {
      setApi({ processTrack: vi.fn().mockRejectedValue(new Error('boom')) })
      const tracks = [track({ id: 'a' })]
      const { result } = renderHook(
        () => useTrackProcessing({ tracks, settings: null, updateTrack: vi.fn() }),
        { wrapper: withClient() },
      )
      await act(async () => {
        await result.current.processAll(tracks)
      })
      expect(result.current.batchSummary).toEqual({ converted: 0, skipped: 0, failed: 1 })
      await act(async () => {
        vi.advanceTimersByTime(6000)
      })
      expect(result.current.batchSummary).toEqual({ converted: 0, skipped: 0, failed: 1 })
    } finally {
      vi.useRealTimers()
    }
  })

  // Each queued job re-read Settings when its turn came, so enabling "overwrite
  // original" (or switching the format) mid-run changed what the REST of the batch did
  // — in-place source rewrites the user never confirmed. The run must convert every
  // track with the settings it was started under.
  it('pins the overwrite and format settings at batch start, ignoring a mid-run change', async () => {
    const tracks = [track({ id: 'a' }), track({ id: 'b' })]
    const settingsA = { outputFormat: 'aiff', overwriteOriginal: false } as Settings
    const settingsB = { outputFormat: 'mp3', overwriteOriginal: true } as Settings
    const processTrack = vi.fn().mockImplementation(async () => {
      rerenderWith(settingsB)
      return { outputPath: '/out/x.aiff' }
    })
    setApi({ processTrack })
    const { result, rerender } = renderHook(
      ({ settings }: { settings: Settings }) =>
        useTrackProcessing({ tracks, settings, updateTrack: vi.fn(), concurrency: 1 }),
      { wrapper: withClient(), initialProps: { settings: settingsA } },
    )
    const rerenderWith = (s: Settings): void => rerender({ settings: s })
    await act(async () => {
      await result.current.processAll(tracks)
    })
    expect(processTrack).toHaveBeenCalledTimes(2)
    expect(processTrack).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: 'b', format: 'aiff', overwriteOriginal: false }),
    )
  })

  // The batch's done/total pools into the top progress bar with the other sweeps; left
  // at {N,N} after the run it kept the bar pinned at 100% forever and skewed every later
  // sweep's pooled fraction. It must return to zero the moment the run ends.
  it('resets the batch progress once a convert-all run finishes', async () => {
    setApi({ processTrack: vi.fn().mockResolvedValue({ outputPath: '/out/a.aiff' }) })
    const tracks = [track({ id: 'a' })]
    const { result } = renderHook(
      () => useTrackProcessing({ tracks, settings: null, updateTrack: vi.fn() }),
      { wrapper: withClient() },
    )
    await act(async () => {
      await result.current.processAll(tracks)
    })
    expect(result.current.batchProgress).toEqual({ done: 0, total: 0 })
  })

  // Same contract for the other sweep that rides the shared batch state.
  it('resets the batch progress once an add-all sweep finishes', async () => {
    setApi({ addToAppleMusic: vi.fn().mockResolvedValue('PID1234ABCD') })
    const tracks = [track({ id: 'a', status: 'done', outputPath: '/out/a.aiff' })]
    const { result } = renderHook(
      () => useTrackProcessing({ tracks, settings: null, updateTrack: vi.fn() }),
      { wrapper: withClient() },
    )
    await act(async () => {
      await result.current.addAllToAppleMusic(['a'])
    })
    expect(result.current.batchProgress).toEqual({ done: 0, total: 0 })
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

  // A re-export replaces the file at the output path, so probes cached for it (the
  // before/after comparison's waveform and loudness of the previous export) describe
  // bytes that no longer exist. Without eviction, converting again with a new
  // normalization shows the OLD output's wave and figures as "after" — or a blank
  // strip pinned forever if the old query had errored.
  it('evicts the output path’s cached probes after a regular conversion', async () => {
    setApi({
      processTrack: vi.fn().mockResolvedValue({ outputPath: '/out/a.aiff', inPlace: false }),
    })
    const client = new QueryClient()
    client.setQueryData(['waveform', '/out/a.aiff'], { peaks: [1], durationSec: 1 })
    client.setQueryData(['loudness', '/out/a.aiff'], { integrated: -9 })
    client.setQueryData(['waveform', '/m/a.wav'], { peaks: [0.5], durationSec: 1 })
    const { result } = renderHook(
      () =>
        useTrackProcessing({ tracks: [track({ id: 'a' })], settings: null, updateTrack: vi.fn() }),
      { wrapper: withClient(client) },
    )
    await act(async () => {
      await result.current.processOne('a')
    })
    expect(client.getQueryData(['waveform', '/out/a.aiff'])).toBeUndefined()
    expect(client.getQueryData(['loudness', '/out/a.aiff'])).toBeUndefined()
    // The source file was not touched by a regular conversion — its probes stay.
    expect(client.getQueryData(['waveform', '/m/a.wav'])).toBeDefined()
  })
})
