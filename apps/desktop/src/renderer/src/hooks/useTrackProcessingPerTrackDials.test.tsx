// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../preload/api'
import type { DeclickMode, NormalizeConfig, TrackMetadata } from '../../../shared/types'
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
  ;(window as unknown as { api: unknown }).api = {
    beginConversionBatch: vi.fn(),
    endConversionBatch: vi.fn(),
    ...over,
  }
}

function withClient(
  client = new QueryClient(),
): (props: { children: React.ReactNode }) => React.JSX.Element {
  return ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

const QUIET: NormalizeConfig = { mode: 'loudness', targetLufs: -18, truePeakDb: -1, peakDb: -1 }
const LOUD: NormalizeConfig = { mode: 'loudness', targetLufs: -7, truePeakDb: -1, peakDb: -1 }

afterEach(() => vi.restoreAllMocks())

// TrackItem.normalize is documented as "The normalization dialled for THIS track", the
// editor stages it there on every change (Editor.tsx onChange({ normalize: n })) and
// re-seeds the dial from it on remount — so a DJ who walks a crate setting a different
// loudness per track has those picks persisted on the rows. The batch convert, however,
// carries ONE normalize override (the last-opened editor's, via editorNormalizeRef) and
// runOne never consults track.normalize, so every track in the run is converted at the
// dial of whichever track happened to be open last.
describe('batch convert honours each track’s own dials', () => {
  it('converts each track at its own staged normalize, not one value for the whole run', async () => {
    const processTrack = vi
      .fn<Api['processTrack']>()
      .mockResolvedValue({ outputPath: '/out/x.aiff', inPlace: false })
    setApi({ processTrack })
    const tracks = [
      track({ id: 'quiet', normalize: QUIET }),
      track({ id: 'loud', normalize: LOUD }),
    ]
    const { result } = renderHook(
      () => useTrackProcessing({ tracks, settings: null, updateTrack: vi.fn() }),
      { wrapper: withClient() },
    )
    // The batch carries the dial of the editor that was open last ("loud"), exactly as
    // App.onProcessAllSelected passes editorNormalizeRef.current for the whole selection.
    await act(async () => {
      await result.current.processAll(tracks, undefined, LOUD)
    })

    const byId = new Map(
      processTrack.mock.calls.map(([job]) => [
        job.id,
        job.normalize as NormalizeConfig | undefined,
      ]),
    )
    expect(byId.get('loud')).toEqual(LOUD)
    // The quiet track was dialled to -18 LUFS and staged on the row; converting it at
    // -7 LUFS silently overrides the user's own per-track pick.
    expect(byId.get('quiet')).toEqual(QUIET)
  })

  it('converts each track at its own staged declick level', async () => {
    const processTrack = vi
      .fn<Api['processTrack']>()
      .mockResolvedValue({ outputPath: '/out/x.aiff', inPlace: false })
    setApi({ processTrack })
    const dusty: DeclickMode = 'strong'
    const clean: DeclickMode = 'off'
    const tracks = [track({ id: 'dusty', declick: dusty }), track({ id: 'clean', declick: clean })]
    const { result } = renderHook(
      () => useTrackProcessing({ tracks, settings: null, updateTrack: vi.fn() }),
      { wrapper: withClient() },
    )
    await act(async () => {
      await result.current.processAll(tracks, undefined, undefined, undefined, clean)
    })

    const byId = new Map(
      processTrack.mock.calls.map(([job]) => [job.id, job.declick as DeclickMode | undefined]),
    )
    expect(byId.get('clean')).toEqual(clean)
    // The dusty rip was dialled to 'strong' on its own row; the batch repairs nothing.
    expect(byId.get('dusty')).toEqual(dusty)
  })

  // The other half of sending the right filter: recording the one that was actually
  // sent. exportedPatch stores it as processedNormalize, and reapply's stale checks
  // compare the user's current dial against exactly that — so a record of the batch
  // pick, when the track converted at its own dial, describes a conversion that never
  // happened. The track would then read as already-normalized at a level it does not
  // carry, and the next Update would skip the filter it still needs (normalizeForJob
  // returns mode:'none' for a track that reads its own export).
  //
  // Worth its own test because nothing else covers it: reverting this record alone
  // leaves the entire suite green.
  it('records the dial it actually converted with, not the batch pick', async () => {
    const processTrack = vi
      .fn<Api['processTrack']>()
      .mockResolvedValue({ outputPath: '/out/x.aiff', inPlace: false })
    setApi({ processTrack })
    const updateTrack = vi.fn()
    const tracks = [track({ id: 'quiet', normalize: QUIET })]
    const { result } = renderHook(
      () => useTrackProcessing({ tracks, settings: null, updateTrack }),
      { wrapper: withClient() },
    )

    await act(async () => {
      await result.current.processAll(tracks, undefined, LOUD)
    })

    const recorded = updateTrack.mock.calls
      .map(([, patch]) => (patch as { processedNormalize?: NormalizeConfig }).processedNormalize)
      .filter(Boolean)
    expect(recorded.at(-1)).toEqual(QUIET)
  })
})
