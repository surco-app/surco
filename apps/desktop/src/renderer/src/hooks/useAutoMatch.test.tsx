// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TrackMetadata } from '../../../shared/types'
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
    searchDiscogs: vi.fn().mockResolvedValue([{ id: 1, title: 'Artist - Album' }]),
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

function setup(tracks: TrackItem[]): {
  result: { current: ReturnType<typeof useAutoMatch> }
  updateTrack: ReturnType<typeof vi.fn>
  tracksRef: { current: TrackItem[] }
} {
  const updateTrack = vi.fn()
  const tracksRef = { current: tracks }
  const { result } = renderHook(() => useAutoMatch({ tracksRef, updateTrack }))
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

  // The import path: a dropped crate must not fire one Discogs search per file at the
  // rate limit — each row waits until the user actually scrolls it into view.
  it('holds an import-enqueued track until its row reports visible', async () => {
    const searchDiscogs = vi.fn().mockResolvedValue([{ id: 1, title: 'Artist - Album' }])
    setApi({ searchDiscogs })
    const tracks = [track('a')]
    const { result, updateTrack } = setup(tracks)

    act(() => result.current.enqueueAutoMatch(tracks, true))
    await new Promise((r) => setTimeout(r, 0))
    expect(searchDiscogs).not.toHaveBeenCalled()

    act(() => result.current.onTrackVisible('a', true))
    await waitFor(() =>
      expect(updateTrack).toHaveBeenCalledWith('a', expect.objectContaining({ autoMatched: true })),
    )
  })

  // A forgotten (removed/rebuilt) track must never probe, even if its row was queued
  // and later reports visible — the queue entry is gone.
  it('never probes a track that was forgotten before its row became visible', async () => {
    const searchDiscogs = vi.fn().mockResolvedValue([{ id: 1, title: 'Artist - Album' }])
    setApi({ searchDiscogs })
    const tracks = [track('a')]
    const { result } = setup(tracks)

    act(() => result.current.enqueueAutoMatch(tracks, true))
    act(() => result.current.forgetTrack('a'))
    act(() => result.current.onTrackVisible('a', true))

    await new Promise((r) => setTimeout(r, 0))
    expect(searchDiscogs).not.toHaveBeenCalled()
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
    const searchDiscogs = vi.fn().mockResolvedValue([{ id: 1, title: 'Artist - Album' }])
    setApi({ searchDiscogs })
    const tracks = [track('a')]
    const { result } = setup(tracks)

    act(() => result.current.enqueueAutoMatch(tracks, true))
    act(() => result.current.cancelAutoMatch())
    act(() => result.current.onTrackVisible('a', true))

    await new Promise((r) => setTimeout(r, 0))
    expect(searchDiscogs).not.toHaveBeenCalled()
    expect(result.current.matching).toBeNull()
  })

  // Whole-crate matching, visible-first: every imported track is enqueued (not gated), but
  // the rows on screen are probed before the rest so the part of the list in view resolves
  // first. Only 'b' is visible here, so it must be searched before 'a'.
  it('matches the whole queue but probes visible rows first', async () => {
    const calls: string[] = []
    const searchDiscogs = vi.fn(async (q: string) => {
      calls.push(q)
      return [{ id: 1, title: 'Artist - Album' }]
    })
    setApi({ searchDiscogs })
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

  // The track the user is looking at must resolve now, not wait behind the rest of the
  // crate: its Discogs calls go through the limiter's high-priority queue (the same lane
  // as a manual search) while every other queued row stays low.
  it('probes the focused track at high priority and the rest low', async () => {
    const searchDiscogs = vi.fn().mockResolvedValue([{ id: 1, title: 'Artist - Album' }])
    setApi({ searchDiscogs })
    const a = track('a')
    a.query = 'query a'
    const b = track('b')
    b.query = 'query b'
    const { result } = setup([a, b])

    act(() => result.current.focusTrack('b'))
    act(() => result.current.enqueueAutoMatch([a, b], false))

    await waitFor(() => expect(searchDiscogs).toHaveBeenCalledTimes(2))
    const hints = { artist: 'Artist', title: 'My Song', catalogNumber: undefined }
    expect(searchDiscogs).toHaveBeenCalledWith('query b', undefined, 'high', hints)
    expect(searchDiscogs).toHaveBeenCalledWith('query a', undefined, 'low', hints)
  })
})
