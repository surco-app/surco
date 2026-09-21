// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../preload/api'
import { DEFAULT_IMPORT_FIELDS } from '../../../shared/defaults'
import type { SearchProviderId, TrackMetadata } from '../../../shared/types'
import { type AppleMusicIndex, buildLibraryIndex } from '../lib/appleMusicLibrary'
import type { TrackItem } from '../types'
import { useAutoMatch } from './useAutoMatch'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const release = {
  // Required, and it decides things: autoMatch branches on it and matchStatKey tallies
  // the match under Discogs, Bandcamp or Deezer by reading it.
  provider: 'discogs' as const,
  id: 1,
  title: 'Album',
  artists: [{ name: 'Artist' }],
  tracklist: [{ position: '1', title: 'My Song', duration: '3:00' }],
}

function setApi(over: Record<string, unknown> = {}): void {
  ;(window as unknown as { api: unknown }).api = {
    search: vi.fn().mockResolvedValue([{ id: 1, title: 'Artist - Album' }]),
    getRelease: vi.fn<Api['getRelease']>().mockResolvedValue(release),
    ...over,
  }
}

function track(id: string): TrackItem {
  return {
    id,
    inputPath: `/m/${id}.wav`,
    fileName: `${id}.wav`,
    listLabel: id,
    query: 'artist my song',
    status: 'idle',
    duration: 180,
    meta: { title: 'My Song', artist: 'Artist' } as TrackMetadata,
  }
}

function setup(
  tracks: TrackItem[],
  libraryIndex: AppleMusicIndex | null = null,
  editingRef: { current: string | null } = { current: null },
  importFields: (keyof TrackMetadata)[] = [...DEFAULT_IMPORT_FIELDS],
): {
  result: { current: ReturnType<typeof useAutoMatch> }
  updateTrack: ReturnType<typeof vi.fn>
  tracksRef: { current: TrackItem[] }
  reportActivity: ReturnType<typeof vi.fn>
} {
  const updateTrack = vi.fn()
  const reportActivity = vi.fn()
  const tracksRef = { current: tracks }
  const libraryIndexRef = { current: libraryIndex }
  const searchProvidersRef: { current: SearchProviderId[] } = { current: ['discogs'] }
  const importFieldsRef = { current: importFields }
  const matchCleanupRef = { current: {} }
  const { result } = renderHook(() =>
    useAutoMatch({
      tracksRef,
      updateTrack,
      libraryIndexRef,
      searchProvidersRef,
      importFieldsRef,
      matchCleanupRef,
      editingRef,
      reportActivity,
    }),
  )
  return { result, updateTrack, tracksRef, reportActivity }
}

describe('useAutoMatch', () => {
  // The toolbar sweep: everything enqueued probes immediately, confident matches are
  // applied and flagged, and the progress state returns to idle once drained.
  it('probes toolbar-enqueued tracks at once and applies confident matches', async () => {
    setApi()
    const tracks = [track('a'), track('b')]
    const { result, updateTrack } = setup(tracks)

    act(() => result.current.enqueueAutoMatch(tracks))

    await waitFor(() => expect(updateTrack).toHaveBeenCalledTimes(2))
    expect(updateTrack).toHaveBeenCalledWith('a', expect.objectContaining({ autoMatched: true }))
    expect(updateTrack).toHaveBeenCalledWith('b', expect.objectContaining({ autoMatched: true }))
    await waitFor(() => expect(result.current.matching).toBeNull())
  })

  // The sweep is the one path that tags without anyone watching — a crate of 600 files
  // applies unattended — so it is where "don't fill this field" matters most. A field the
  // user switched off must survive the sweep untouched, and one left on must still be
  // written, or the preference would only hold in the editor.
  it('respects the import-field choice when applying unattended', async () => {
    setApi({
      getRelease: vi.fn<Api['getRelease']>().mockResolvedValue({ ...release, country: 'Europe' }),
    })
    const tracks = [track('a')]
    const { result, updateTrack } = setup(tracks, null, { current: null }, ['album'])

    act(() => result.current.enqueueAutoMatch(tracks))

    await waitFor(() => expect(updateTrack).toHaveBeenCalledTimes(1))
    const patch = updateTrack.mock.calls[0][1] as { meta: TrackMetadata }
    expect(patch.meta.album).toBe('Album')
    expect(patch.meta.country).toBe('')
  })

  // A field buffers its text and only commits to the track array on pause/blur, so while
  // the user types the edit isn't in the live meta yet and the meta-identity guard can't
  // see it. If a match landed in that window it would overwrite the row being typed into.
  // The sweep therefore also leaves alone whichever track is under active edit (editingRef).
  it('never applies a match to the track whose field is being edited', async () => {
    setApi()
    const tracks = [track('a'), track('b')]
    const editingRef = { current: 'a' }
    const { result, updateTrack } = setup(tracks, null, editingRef)

    act(() => result.current.enqueueAutoMatch(tracks))

    // The untouched track still matches; the one being edited is left alone.
    await waitFor(() =>
      expect(updateTrack).toHaveBeenCalledWith('b', expect.objectContaining({ autoMatched: true })),
    )
    await waitFor(() => expect(result.current.matching).toBeNull())
    expect(updateTrack).not.toHaveBeenCalledWith('a', expect.anything())
  })

  // A plausible-but-unconfirmed match (review tier) is flagged on the row for the user to
  // confirm in the editor — its metadata is NOT written, so the file keeps its own tags and
  // the sweep won't re-probe it.
  it('flags a review-tier match without applying its metadata', async () => {
    setApi({
      getRelease: vi.fn<Api['getRelease']>().mockResolvedValue({
        provider: 'discogs',
        id: 1,
        title: 'Album',
        artists: [{ name: 'Artist' }],
        // A title-only hit with no duration to corroborate it scores 'review', not 'high'.
        tracklist: [{ position: '1', title: 'My Song (Club Mix)' }],
      }),
    })
    const tracks = [track('a')]
    const { result, updateTrack } = setup(tracks)

    act(() => result.current.enqueueAutoMatch(tracks))

    await waitFor(() => expect(updateTrack).toHaveBeenCalled())
    expect(updateTrack).toHaveBeenCalledWith('a', expect.objectContaining({ matchReview: true }))
    const patch = updateTrack.mock.calls[0][1]
    expect(patch.meta).toBeUndefined()
    expect(patch.matched).toBeUndefined()
    expect(patch.matchConfidence).toBeGreaterThan(0)
  })

  // The import path: a dropped folder of a thousand files is left to run unattended, so
  // every row must be probed without waiting for the user to scroll it into view — a
  // sweep that stalled at the twenty rows on screen read as "auto-match stopped at 20".
  it('probes an import-enqueued track without waiting for its row to be visible', async () => {
    setApi()
    const tracks = [track('a')]
    const { result, updateTrack } = setup(tracks)

    act(() => result.current.enqueueAutoMatch(tracks))

    await waitFor(() =>
      expect(updateTrack).toHaveBeenCalledWith('a', expect.objectContaining({ autoMatched: true })),
    )
  })

  // Rows on screen still go first: the slice the user is looking at resolves before the
  // rest of the folder, and the visibility signal is what orders the queue.
  it('probes the rows on screen ahead of the rest of the queue', async () => {
    const search = vi.fn().mockResolvedValue([{ id: 1, title: 'Artist - Album' }])
    setApi({ search })
    const tracks = [track('a'), track('b'), { ...track('c'), query: 'the row on screen' }]
    const { result } = setup(tracks)

    act(() => result.current.onTrackVisible('c', true))
    act(() => result.current.enqueueAutoMatch(tracks))

    await waitFor(() => expect(search).toHaveBeenCalledTimes(3))
    expect(search.mock.calls[0][0]).toBe('the row on screen')
  })

  // A forgotten (removed/rebuilt) track must never probe, even if its row was queued
  // and later reports visible — the queue entry is gone.
  it('never probes a track that was forgotten while still waiting its turn', async () => {
    const search = vi.fn().mockResolvedValue([{ id: 1, title: 'Artist - Album' }])
    setApi({ search })
    const tracks = [track('a'), track('b'), { ...track('c'), query: 'forgotten' }]
    const { result } = setup(tracks)

    act(() => result.current.enqueueAutoMatch(tracks))
    act(() => result.current.forgetTrack('c'))
    act(() => result.current.onTrackVisible('c', true))

    await waitFor(() => expect(result.current.matching).toBeNull())
    await new Promise((r) => setTimeout(r, 300))
    expect(search).toHaveBeenCalledTimes(2)
    expect(search).not.toHaveBeenCalledWith(
      'forgotten',
      expect.anything(),
      expect.anything(),
      expect.anything(),
    )
  })

  // Cancel mid-sweep: tracks whose probes haven't applied yet are left untouched, and
  // the progress state still settles back to idle.
  it('stops applying once cancelled and settles back to idle', async () => {
    let releaseGate: () => void = () => {}
    const gate = new Promise<void>((res) => {
      releaseGate = res
    })
    setApi({
      getRelease: vi.fn(async () => {
        await gate
        return release
      }),
    })
    const tracks = [track('a')]
    const { result, updateTrack } = setup(tracks)

    act(() => result.current.enqueueAutoMatch(tracks))
    await waitFor(() => expect(result.current.matching).not.toBeNull())

    act(() => result.current.cancelAutoMatch())
    releaseGate()

    await waitFor(() => expect(result.current.matching).toBeNull())
    expect(updateTrack).not.toHaveBeenCalled()
  })

  // Cancelling (what disabling auto-match in Settings calls) must empty the queue, not just
  // flag the current probes: onTrackVisible pumps unconditionally, so a row scrolled in
  // afterwards would otherwise quietly resume matching the supposedly-stopped sweep.
  it('drops queued matches on cancel so a row scrolled in later never probes', async () => {
    const search = vi.fn().mockResolvedValue([{ id: 1, title: 'Artist - Album' }])
    setApi({ search })
    const tracks = [track('a'), track('b'), { ...track('c'), query: 'still queued' }]
    const { result } = setup(tracks)

    act(() => result.current.enqueueAutoMatch(tracks))
    act(() => result.current.cancelAutoMatch())
    act(() => result.current.onTrackVisible('c', true))

    await new Promise((r) => setTimeout(r, 300))
    expect(search).toHaveBeenCalledTimes(2)
    expect(search).not.toHaveBeenCalledWith(
      'still queued',
      expect.anything(),
      expect.anything(),
      expect.anything(),
    )
    expect(result.current.matching).toBeNull()
  })

  // A cancel followed by a fresh enqueue, both firing while the old pump's probe is
  // still in flight: enqueue's own pumpAutoMatch() call sees matchingRef still true
  // (the old pump hasn't reached its finally yet) and no-ops. When the old pump's
  // finally does run, it must notice the queue was repopulated after the cancel and
  // re-pump — not take the matchCancel-was-true branch and reset to idle, stranding
  // the re-enqueued track with no pump watching it until the next scroll/select event.
  it('re-pumps a track enqueued right after cancel instead of stranding it', async () => {
    let releaseGate: () => void = () => {}
    const gate = new Promise<void>((res) => {
      releaseGate = res
    })
    const search = vi.fn().mockResolvedValue([{ id: 1, title: 'Artist - Album' }])
    setApi({
      search,
      getRelease: vi.fn(async () => {
        await gate
        return release
      }),
    })
    const a = track('a')
    const b = track('b')
    const { result, tracksRef } = setup([a])

    act(() => result.current.enqueueAutoMatch([a]))
    await waitFor(() => expect(search).toHaveBeenCalledTimes(1))

    // Cancel while 'a's getRelease is still gated, then immediately re-enqueue 'b' —
    // both before the old pump's finally has a chance to run.
    act(() => result.current.cancelAutoMatch())
    tracksRef.current = [a, b]
    act(() => result.current.enqueueAutoMatch([b]))

    releaseGate()

    await waitFor(() => expect(search).toHaveBeenCalledTimes(2))
  })

  // Whole-crate matching, visible-first: every imported track is enqueued (not gated), but
  // the rows on screen are probed before the rest so the part of the list in view resolves
  // first. Only 'b' is visible here, so it must be searched before 'a'.
  it('matches the whole queue but probes visible rows first', async () => {
    const calls: string[] = []
    const search = vi.fn(async (q: string) => {
      calls.push(q)
      return [{ id: 1, title: 'Artist - Album' }]
    })
    setApi({ search })
    const a = track('a')
    a.query = 'query a'
    const b = track('b')
    b.query = 'query b'
    const { result } = setup([a, b])

    act(() => result.current.onTrackVisible('b', true))
    act(() => result.current.enqueueAutoMatch([a, b]))

    await waitFor(() => expect(calls).toHaveLength(2))
    expect(calls[0]).toBe('query b')
  })

  // The whole point of the sweep re-checking the library: a file whose own messy tags don't
  // match the library ('Unknown DJ') but whose confident Discogs match resolves to the
  // canonical artist the library knows ('Artist') must be pinned owned, so the list/filter
  // agree with the editor's badge without the user opening the row.
  it('pins inLibraryResolved when the canonical match proves the track is owned', async () => {
    setApi()
    const t = track('a')
    // Raw tags the library can't recognise; the Discogs match canonicalises the artist.
    t.meta = { title: 'My Song', artist: 'Unknown DJ' } as TrackMetadata
    const index = buildLibraryIndex([{ title: 'My Song', artist: 'Artist' }])
    const { result, updateTrack } = setup([t], index)

    act(() => result.current.enqueueAutoMatch([t]))

    await waitFor(() => expect(updateTrack).toHaveBeenCalled())
    expect(updateTrack).toHaveBeenCalledWith(
      'a',
      expect.objectContaining({ autoMatched: true, inLibraryResolved: true }),
    )
  })

  // The list already recomputes the not-owned verdict from the raw tags, so the sweep must
  // not pin a verdict when the canonical match isn't in the library — pinning false would be
  // redundant and would fight a snapshot that lands later.
  it('does not pin inLibraryResolved when the match is not in the library', async () => {
    setApi()
    const t = track('a')
    const index = buildLibraryIndex([{ title: 'Something Else', artist: 'Other' }])
    const { result, updateTrack } = setup([t], index)

    act(() => result.current.enqueueAutoMatch([t]))

    await waitFor(() => expect(updateTrack).toHaveBeenCalled())
    const patch = updateTrack.mock.calls[0][1]
    expect(patch.autoMatched).toBe(true)
    expect(patch.inLibraryResolved).toBeUndefined()
  })

  // The track the user is looking at must resolve now, not wait behind the rest of the
  // crate: its Discogs calls go through the limiter's high-priority queue (the same lane
  // as a manual search) while every other queued row stays low.
  it('probes the focused track at high priority and the rest low', async () => {
    const search = vi.fn().mockResolvedValue([{ id: 1, title: 'Artist - Album' }])
    setApi({ search })
    const a = track('a')
    a.query = 'query a'
    const b = track('b')
    b.query = 'query b'
    const { result } = setup([a, b])

    act(() => result.current.focusTrack('b'))
    act(() => result.current.enqueueAutoMatch([a, b]))

    await waitFor(() => expect(search).toHaveBeenCalledTimes(2))
    const hints = { artist: 'Artist', title: 'My Song', catalogNumber: undefined }
    expect(search).toHaveBeenCalledWith('query b', 'discogs', 'high', hints)
    expect(search).toHaveBeenCalledWith('query a', 'discogs', 'low', hints)
  })

  // Every probe verdict lands in the activity feed so the user can read *why* a row was
  // matched, flagged for review or left alone — the debug trail behind the sparkle.
  it('reports an applied match to the activity feed with its reasoning', async () => {
    setApi()
    const tracks = [track('a')]
    const { result, reportActivity } = setup(tracks)

    act(() => result.current.enqueueAutoMatch(tracks))

    await waitFor(() => expect(reportActivity).toHaveBeenCalledTimes(1))
    expect(reportActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'match',
        labelKey: 'activity.autoMatchApplied',
        labelParams: { track: 'My Song' },
        detailKey: 'activity.autoMatchAppliedDetail',
      }),
    )
  })

  it('reports a no-match verdict to the activity feed', async () => {
    setApi({
      getRelease: vi.fn<Api['getRelease']>().mockResolvedValue({
        provider: 'discogs',
        id: 1,
        title: 'Album',
        artists: [],
        tracklist: [{ position: '1', title: 'Something Entirely Different' }],
      }),
    })
    const tracks = [track('a')]
    const { result, reportActivity } = setup(tracks)

    act(() => result.current.enqueueAutoMatch(tracks))

    await waitFor(() => expect(reportActivity).toHaveBeenCalledTimes(1))
    expect(reportActivity).toHaveBeenCalledWith(
      expect.objectContaining({ labelKey: 'activity.autoMatchNone' }),
    )
  })
})
