// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type React from 'react'
import { useRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { emptyMetadata } from '../../../shared/metadata'
import type { TrackMetadata } from '../../../shared/types'
import { HEAVY_PROBE_GC_MS } from '../lib/analysisQueries'
import * as duplicates from '../lib/duplicates'
import type { TrackItem } from '../types'
import * as snapshot from './tracksSnapshot'
import { useTracksView, type ViewCacheEntry } from './useTracksView'
import { waveformOptions } from './useWaveform'

function setApi(): void {
  ;(window as unknown as { api: unknown }).api = {
    // Off macOS the Apple Music snapshot never loads, keeping the library axis out of
    // these tests; the resolved/persistent-id merges are still exercised below.
    platform: 'win32',
    onWindowFocus: () => () => {},
  }
}

function track(
  id: string,
  meta: Partial<TrackMetadata> = {},
  extra: Partial<TrackItem> = {},
): TrackItem {
  return {
    id,
    inputPath: `/music/${id}.wav`,
    fileName: `${id}.wav`,
    listLabel: id,
    query: '',
    status: 'idle',
    meta: { ...emptyMetadata(), ...meta },
    ...extra,
  }
}

const spectrum = { image: 'data:image/png;base64,', cutoffHz: 16000, sampleRateHz: 44100 }

function setup(
  initialTracks: TrackItem[],
  client = new QueryClient(),
  source: 'appleMusic' | 'engineDj' | null = 'appleMusic',
) {
  setApi()
  const wrapper = ({ children }: { children: React.ReactNode }): React.JSX.Element => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const rendered = renderHook(
    ({ tracks }: { tracks: TrackItem[] }) => {
      const viewCache = useRef(new Map<string, ViewCacheEntry>())
      return useTracksView(tracks, viewCache, source)
    },
    { wrapper, initialProps: { tracks: initialTracks } },
  )
  return { ...rendered, client }
}

afterEach(() => vi.restoreAllMocks())

describe('useTracksView', () => {
  // The list's verdict dots read from the same query cache the hover prefetch, the
  // sweep and the editor fill — the merge is what turns a cached analysis into a
  // visible verdict without re-running ffmpeg.
  it('merges a cached spectrum onto its track', () => {
    const client = new QueryClient()
    client.setQueryData(['spectrogram', '/music/a.wav'], spectrum)
    const { result } = setup([track('a'), track('b')], client)
    expect(result.current.tracksView[0].spectrum).toEqual(spectrum)
    expect(result.current.tracksView[1].spectrum).toBeUndefined()
  })

  // The memoized rows only skip re-rendering if an unchanged track keeps the same view
  // object across renders — this identity contract is what keeps a progress tick on one
  // row from repainting five hundred.
  it('keeps the same view identity for an unchanged track across re-renders', () => {
    const client = new QueryClient()
    client.setQueryData(['spectrogram', '/music/a.wav'], spectrum)
    const a = track('a')
    const b = track('b')
    const { result, rerender } = setup([a, b], client)
    const firstViewA = result.current.tracksView[0]

    // A new array with the same track objects — the shape every progress tick produces.
    rerender({ tracks: [a, b] })
    expect(result.current.tracksView[0]).toBe(firstViewA)
  })

  // A track Surco itself added to Apple Music (musicPersistentId) is owned by
  // definition — it must read in-library even before any snapshot loads.
  it('treats a track it added to Apple Music as owned without a snapshot', () => {
    const { result } = setup([track('a', {}, { musicPersistentId: 'X1' })])
    expect(result.current.tracksView[0].inLibrary).toBe(true)
  })

  // Ownership is per-library: an Apple Music persistent ID says nothing about the
  // Engine database, and vice versa — mixing them would flag tracks the destination
  // library has never seen.
  it('scopes the owned-by-definition flags to the active library source', () => {
    const { result } = setup(
      [track('a', {}, { musicPersistentId: 'X1' }), track('b', {}, { engineDjAdded: true })],
      new QueryClient(),
      'engineDj',
    )
    expect(result.current.tracksView[0].inLibrary).toBeUndefined()
    expect(result.current.tracksView[1].inLibrary).toBe(true)
  })

  // Two files carrying the same folded artist+title are the same song twice; the
  // merged flag is what the duplicates filter bucket reads.
  it('flags both halves of a duplicated song', () => {
    const { result } = setup([
      track('a', { title: 'Strobe', artist: 'deadmau5' }),
      track('b', { title: 'Strobe', artist: 'deadmau5' }),
      track('c', { title: 'Ghosts', artist: 'deadmau5' }),
    ])
    expect(result.current.tracksView.map((t) => t.duplicate ?? false)).toEqual([true, true, false])
  })

  // The duplicate scan folds artist+title (NFD normalize + regex) per track — the heaviest
  // per-track work here. A background analysis landing re-mints the tracks array without
  // touching any tag, so re-folding on that tick would burn CPU that competes with typing.
  // It must re-fold only when an artist or title actually changes.
  it('does not re-scan duplicates when a tick changes nothing about artist or title', () => {
    const dupSpy = vi.spyOn(duplicates, 'duplicateIds')
    const a = track('a', { title: 'Strobe', artist: 'deadmau5' })
    const b = track('b', { title: 'Ghosts', artist: 'deadmau5' })
    const { rerender } = setup([a, b])
    const afterFirst = dupSpy.mock.calls.length

    // A progress tick hands back fresh track objects (new identity) with the same tags.
    rerender({ tracks: [{ ...a }, { ...b }] })
    expect(dupSpy.mock.calls.length).toBe(afterFirst)

    // An actual title edit must re-scan.
    rerender({ tracks: [{ ...a, meta: { ...a.meta, title: 'Ghosts' } }, { ...b }] })
    expect(dupSpy.mock.calls.length).toBeGreaterThan(afterFirst)
  })
  // The attention filters' facts, derived from whatever wave any consumer decoded:
  // silence flags a suggested cut the track hasn't staged (a staged trim clears it —
  // that's the "already retouched" signal), clipping follows the decoder's flags.
  it('derives silence and clipping facts from a cached waveform', () => {
    const client = new QueryClient()
    // 100 s: 10 s of surface noise, music with a clipped stretch, clean tail cut.
    const peaks = Array.from({ length: 200 }, (_, i) => (i >= 20 ? 0.5 : 0.0005))
    const clipped = peaks.map((_, i) => i === 100)
    // Silence rides the peaks probe; clipping rides the heavier scan probe (its own
    // cache entry since the split), and the list reads both to keep both facts.
    client.setQueryData(['waveform', '/music/a.wav'], { peaks, durationSec: 100 })
    client.setQueryData(['waveform', '/music/b.wav'], { peaks, durationSec: 100 })
    client.setQueryData(['waveformScan', '/music/a.wav'], { clipped })
    client.setQueryData(['waveformScan', '/music/b.wav'], { clipped })
    const { result } = setup([track('a'), track('b', {}, { trim: { startSec: 9.9 } })], client)
    expect(result.current.tracksView[0].audioIssues).toEqual({ silence: true, clipping: true })
    // Same wave, but the trim is staged: nothing left to retouch on the silence axis.
    expect(result.current.tracksView[1].audioIssues).toEqual({ silence: false, clipping: true })
  })

  // The grid triage fact rides the same passive observation: a coin-flip
  // detection flags the track — unless the user already confirmed a grid by
  // hand, which IS the review.
  it('derives the grid-to-review fact from a cached coin-flip detection', () => {
    const client = new QueryClient()
    const coinFlip = {
      bpm: 128,
      confidence: 0.8,
      anchorSec: 0.1,
      phaseAmbiguity: 1,
      phaseMargin: 1,
    }
    client.setQueryData(['beatgrid', '/music/a.wav'], coinFlip)
    client.setQueryData(['beatgrid', '/music/b.wav'], coinFlip)
    const { result } = setup(
      [track('a'), track('b', {}, { beatgrid: { bpm: 128, anchorSec: 0.1 } })],
      client,
    )
    expect(result.current.tracksView[0].gridReview).toBe(true)
    expect(result.current.tracksView[1].gridReview).toBeUndefined()
  })

  // The list reads the cache without subscribing to it per track. This is what lets the
  // heavy families (a waveform's peaks and a spectrogram's PNG — ~0.5 MB a track) ever be
  // collected: React Query only starts a query's gcTime countdown once it has no observers
  // left, so an observer per track per family would pin every analysed track's payload for
  // the whole session no matter what gcTime says. Rendering the list must not be what keeps
  // the memory alive.
  it('observes the cache without mounting an observer per track', () => {
    const client = new QueryClient()
    const tracks = ['a', 'b', 'c'].map((id) => track(id))
    for (const t of tracks) {
      client.setQueryData(['waveform', t.inputPath], {
        peaks: [0.5],
        durationSec: 1,
        clipped: [false],
      })
      client.setQueryData(['spectrogram', t.inputPath], spectrum)
    }

    const { result } = setup(tracks, client)

    // The merge still sees everything the cache holds…
    expect(result.current.tracksView.map((t) => t.spectrum)).toEqual([spectrum, spectrum, spectrum])
    // …yet not one per-track probe is left observed, so nothing here pins those payloads.
    // (The session's single library-membership snapshot stays observed on purpose: it is
    // one query for the whole list, not one per track, and holds no audio payload.)
    const observed = client
      .getQueryCache()
      .getAll()
      .filter((q) => q.getObserversCount() > 0)
      .map((q) => q.queryKey[0])
    expect(observed).not.toContain('waveform')
    expect(observed).not.toContain('spectrogram')
    expect(observed).not.toContain('beatgrid')
  })

  // The payoff of reading without observing, end to end: with the list rendered, a heavy
  // payload still becomes collectable, because nothing observes it. This is the assertion
  // that makes HEAVY_PROBE_GC_MS real rather than decorative — before the cache-subscription
  // read, the list's own observer kept the countdown from ever starting, so a crate analysed
  // end to end held every peak array and every spectrogram PNG until quit.
  it('lets an analysed waveform be collected while the list is still on screen', async () => {
    vi.useFakeTimers()
    const client = new QueryClient()
    const tracks = [track('a')]
    // Fetched through the real options, so it carries the family's gcTime — not setQueryData,
    // which would mint an entry with the client's defaults instead.
    ;(window as unknown as { api: { waveform: () => Promise<unknown> } }).api = {
      ...(window as unknown as { api: object }).api,
      waveform: async () => ({ peaks: [0.5], durationSec: 1, clipped: [false] }),
    }
    await client.fetchQuery(waveformOptions('/music/a.wav'))
    expect(client.getQueryData(['waveform', '/music/a.wav'])).toBeDefined()

    setup(tracks, client)

    // The list is up and reading that wave — and it is still unobserved, so the clock runs.
    vi.advanceTimersByTime(HEAVY_PROBE_GC_MS + 1_000)
    expect(client.getQueryData(['waveform', '/music/a.wav'])).toBeUndefined()
    vi.useRealTimers()
  })

  // The merge's identity stability is what keeps a progress tick from re-running the whole
  // triage pipeline: the snapshot the list reads must only change identity when a probe
  // result actually changes, never merely because App re-rendered.
  it('keeps the same view identity across a re-render that changed nothing', () => {
    const client = new QueryClient()
    client.setQueryData(['spectrogram', '/music/a.wav'], spectrum)
    const tracks = [track('a')]
    const { result, rerender } = setup(tracks, client)
    const first = result.current.tracksView

    rerender({ tracks })

    expect(result.current.tracksView).toBe(first)
  })

  // The load-bearing perf contract: during an "analyze all" sweep every probe completion
  // fires a cache event, and rebuilding the whole positional snapshot (a slot read for every
  // one of N tracks) on each one is the O(N)-per-event cost that makes a big crate's list
  // tick. A probe landing for one track must read only that track's slot, never all N — so a
  // probe event costs exactly one slot read, whatever the crate size.
  it('patches one slot on a probe event instead of rebuilding the whole snapshot', () => {
    const client = new QueryClient()
    const tracks = ['a', 'b', 'c'].map((id) => track(id))
    const { result } = setup(tracks, client)
    // Spy AFTER mount so the initial full build isn't counted — we're measuring the per-event
    // cost, which is what a sweep pays hundreds of times.
    const buildSpy = vi.spyOn(snapshot, 'buildCacheSnapshot')
    const patchSpy = vi.spyOn(snapshot, 'patchSnapshot')

    // A single probe finishes for track b — the shape every sweep tick produces.
    act(() => {
      client.setQueryData(['spectrogram', '/music/b.wav'], spectrum)
    })

    // The new verdict is visible…
    expect(result.current.tracksView[1].spectrum).toEqual(spectrum)
    // …reached by patching track b's slot (index 1) directly — setQueryData fires more than
    // one cache event, but each is the same O(1) targeted patch, never a full rebuild over N.
    expect(patchSpy).toHaveBeenCalledWith(
      expect.anything(),
      1,
      '/music/b.wav',
      expect.any(Function),
    )
    expect(buildSpy).not.toHaveBeenCalled()
  })

  // The counterpart: a real change to the track set (an import, a removal, a reorder) does
  // need a fresh positional snapshot, so the full rebuild must run for that. Only a probe
  // event on an unchanged set is spared it.
  it('rebuilds the snapshot when the track set itself changes', () => {
    const client = new QueryClient()
    const a = track('a')
    const { rerender } = setup([a], client)
    const buildSpy = vi.spyOn(snapshot, 'buildCacheSnapshot')

    rerender({ tracks: [a, track('b')] })
    expect(buildSpy).toHaveBeenCalledTimes(1)
  })
})
