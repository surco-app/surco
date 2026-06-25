// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SearchProviderId, TrackMetadata } from '../../../shared/types'
import { type AppleMusicIndex, buildLibraryIndex } from '../lib/appleMusicLibrary'
import type { TrackItem } from '../types'
import { useAutoMatch } from './useAutoMatch'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const release = {
  id: 1,
  title: 'Album',
  artists: [{ name: 'Artist' }],
  tracklist: [{ position: '1', title: 'My Song', duration: '3:00' }],
}

function setApi(over: Record<string, unknown> = {}): void {
  ;(window as unknown as { api: unknown }).api = {
    search: vi.fn().mockResolvedValue([{ id: 1, title: 'Artist - Album' }]),
    getRelease: vi.fn().mockResolvedValue(release),
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
): {
  result: { current: ReturnType<typeof useAutoMatch> }
  updateTrack: ReturnType<typeof vi.fn>
  tracksRef: { current: TrackItem[] }
} {
  const updateTrack = vi.fn()
  const tracksRef = { current: tracks }
  const libraryIndexRef = { current: libraryIndex }
  const searchProvidersRef: { current: SearchProviderId[] } = { current: ['discogs'] }
  const { result } = renderHook(() =>
    useAutoMatch({ tracksRef, updateTrack, libraryIndexRef, searchProvidersRef }),
  )
  return { result, updateTrack, tracksRef }
}

describe('useAutoMatch', () => {
  // The toolbar sweep: everything enqueued probes immediately, confident matches are
  // applied and flagged, and the progress state returns to idle once drained.
  it('probes toolbar-enqueued tracks at once and applies confident matches', async () => {
    setApi()
    const tracks = [track('a'), track('b')]
    const { result, updateTrack } = setup(tracks)

    act(() => result.current.enqueueAutoMatch(tracks, false))

    await waitFor(() => expect(updateTrack).toHaveBeenCalledTimes(2))
    expect(updateTrack).toHaveBeenCalledWith('a', expect.objectContaining({ autoMatched: true }))
    expect(updateTrack).toHaveBeenCalledWith('b', expect.objectContaining({ autoMatched: true }))
    await waitFor(() => expect(result.current.matching).toBeNull())
  })

  // A plausible-but-unconfirmed match (review tier) is flagged on the row for the user to
  // confirm in the editor — its metadata is NOT written, so the file keeps its own tags and
  // the sweep won't re-probe it.
  it('flags a review-tier match without applying its metadata', async () => {
    setApi({
      getRelease: vi.fn().mockResolvedValue({
        id: 1,
        title: 'Album',
        artists: [{ name: 'Artist' }],
        // A title-only hit with no duration to corroborate it scores 'review', not 'high'.
        tracklist: [{ position: '1', title: 'My Song (Club Mix)' }],
      }),
    })
    const tracks = [track('a')]
    const { result, updateTrack } = setup(tracks)

    act(() => result.current.enqueueAutoMatch(tracks, false))

    await waitFor(() => expect(updateTrack).toHaveBeenCalled())
    expect(updateTrack).toHaveBeenCalledWith('a', expect.objectContaining({ matchReview: true }))
    const patch = updateTrack.mock.calls[0][1]
    expect(patch.meta).toBeUndefined()
    expect(patch.matched).toBeUndefined()
    expect(patch.matchConfidence).toBeGreaterThan(0)
  })

  // The import path: a dropped crate must not fire one Discogs search per file at the
  // rate limit — each row waits until the user actually scrolls it into view.
  it('holds an import-enqueued track until its row reports visible', async () => {
    const search = vi.fn().mockResolvedValue([{ id: 1, title: 'Artist - Album' }])
    setApi({ search })
    const tracks = [track('a')]
    const { result, updateTrack } = setup(tracks)

    act(() => result.current.enqueueAutoMatch(tracks, true))
    await new Promise((r) => setTimeout(r, 0))
    expect(search).not.toHaveBeenCalled()

    act(() => result.current.onTrackVisible('a', true))
    await waitFor(() =>
      expect(updateTrack).toHaveBeenCalledWith('a', expect.objectContaining({ autoMatched: true })),
    )
  })

  // A forgotten (removed/rebuilt) track must never probe, even if its row was queued
  // and later reports visible — the queue entry is gone.
  it('never probes a track that was forgotten before its row became visible', async () => {
    const search = vi.fn().mockResolvedValue([{ id: 1, title: 'Artist - Album' }])
    setApi({ search })
    const tracks = [track('a')]
    const { result } = setup(tracks)

    act(() => result.current.enqueueAutoMatch(tracks, true))
    act(() => result.current.forgetTrack('a'))
    act(() => result.current.onTrackVisible('a', true))

    await new Promise((r) => setTimeout(r, 0))
    expect(search).not.toHaveBeenCalled()
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

    act(() => result.current.enqueueAutoMatch(tracks, false))
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
    const tracks = [track('a')]
    const { result } = setup(tracks)

    act(() => result.current.enqueueAutoMatch(tracks, true))
    act(() => result.current.cancelAutoMatch())
    act(() => result.current.onTrackVisible('a', true))

    await new Promise((r) => setTimeout(r, 0))
    expect(search).not.toHaveBeenCalled()
    expect(result.current.matching).toBeNull()
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
    act(() => result.current.enqueueAutoMatch([a, b], false))

    await waitFor(() => expect(calls).toHaveLength(2))
    expect(calls[0]).toBe('query b')
  })

  // The whole point of the sweep re-checking the library: a file whose own messy tags don't
  // match the library ('Unknown DJ') but whose confident Discogs match resolves to the
  // canonical artist the library knows ('Artist') must be pinned owned, so the list/filter
  // agree with the editor's badge without the user opening the row.
  it('pins inAppleMusicResolved when the canonical match proves the track is owned', async () => {
    setApi()
    const t = track('a')
    // Raw tags the library can't recognise; the Discogs match canonicalises the artist.
    t.meta = { title: 'My Song', artist: 'Unknown DJ' } as TrackMetadata
    const index = buildLibraryIndex([{ title: 'My Song', artist: 'Artist' }])
    const { result, updateTrack } = setup([t], index)

    act(() => result.current.enqueueAutoMatch([t], false))

    await waitFor(() => expect(updateTrack).toHaveBeenCalled())
    expect(updateTrack).toHaveBeenCalledWith(
      'a',
      expect.objectContaining({ autoMatched: true, inAppleMusicResolved: true }),
    )
  })

  // The list already recomputes the not-owned verdict from the raw tags, so the sweep must
  // not pin a verdict when the canonical match isn't in the library — pinning false would be
  // redundant and would fight a snapshot that lands later.
  it('does not pin inAppleMusicResolved when the match is not in the library', async () => {
    setApi()
    const t = track('a')
    const index = buildLibraryIndex([{ title: 'Something Else', artist: 'Other' }])
    const { result, updateTrack } = setup([t], index)

    act(() => result.current.enqueueAutoMatch([t], false))

    await waitFor(() => expect(updateTrack).toHaveBeenCalled())
    const patch = updateTrack.mock.calls[0][1]
    expect(patch.autoMatched).toBe(true)
    expect(patch.inAppleMusicResolved).toBeUndefined()
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
    act(() => result.current.enqueueAutoMatch([a, b], false))

    await waitFor(() => expect(search).toHaveBeenCalledTimes(2))
    const hints = { artist: 'Artist', title: 'My Song', catalogNumber: undefined }
    expect(search).toHaveBeenCalledWith('query b', 'discogs', 'high', hints)
    expect(search).toHaveBeenCalledWith('query a', 'discogs', 'low', hints)
  })
})
