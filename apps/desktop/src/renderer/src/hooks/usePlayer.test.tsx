// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import type React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mediaUrl } from '../../../shared/media'
import type { TrackMetadata } from '../../../shared/types'
import type { TrackItem } from '../types'
import { usePlayer } from './usePlayer'

afterEach(cleanup)

beforeEach(() => {
  ;(window as unknown as { api: unknown }).api = { recordStat: vi.fn() }
})

function track(id: string, inputPath: string): TrackItem {
  return {
    id,
    inputPath,
    fileName: id,
    listLabel: id,
    query: '',
    status: 'idle',
    meta: {} as TrackMetadata,
  }
}

function Harness({ tracks }: { tracks: TrackItem[] }): React.JSX.Element {
  const { audioRef, togglePlay } = usePlayer({
    tracks,
    selected: tracks[0] ?? null,
    selectedId: tracks[0]?.id ?? null,
  })
  return (
    <>
      {/* biome-ignore lint/a11y/useMediaCaption: silent test fixture */}
      <audio ref={audioRef} data-testid="audio" />
      <button type="button" data-testid="toggle" onClick={togglePlay} />
    </>
  )
}

describe('usePlayer', () => {
  // An in-place export rewrites (and can rename) the playing track's file under the
  // stream; the element must restart from the new path instead of holding a file
  // that no longer exists.
  it('restarts the stream when an in-place export moves the playing file', () => {
    const { rerender } = render(<Harness tracks={[track('a', '/m/a.wav')]} />)
    const audio = screen.getByTestId('audio') as HTMLAudioElement
    audio.play = vi.fn().mockResolvedValue(undefined)
    audio.pause = vi.fn()
    audio.load = vi.fn()

    fireEvent.click(screen.getByTestId('toggle'))
    expect(audio.src).toContain('a.wav')

    rerender(<Harness tracks={[track('a', '/m/a-renamed.aiff')]} />)
    expect(audio.src).toContain('a-renamed.aiff')
  })

  // Right-click "Start over" rebuilds the playing track under a fresh id (same file) and
  // moves the selection onto it. The player must stop with the track it was sounding —
  // not silently re-arm playback on the rebuilt row after its card has already closed,
  // which left the audio playing with no visible player to pause it.
  it('stops playback when Start over rebuilds the playing track under a new id', () => {
    const { rerender } = render(<Harness tracks={[track('a', '/m/a.wav')]} />)
    const audio = screen.getByTestId('audio') as HTMLAudioElement
    audio.play = vi.fn().mockResolvedValue(undefined)
    audio.pause = vi.fn()
    audio.load = vi.fn()

    fireEvent.click(screen.getByTestId('toggle'))
    expect(audio.play).toHaveBeenCalledTimes(1)
    expect(audio.src).toContain('a.wav')

    rerender(<Harness tracks={[track('a2', '/m/a.wav')]} />)

    expect(audio.pause).toHaveBeenCalled()
    expect(audio.play).toHaveBeenCalledTimes(1)
    expect(audio.getAttribute('src')).toBeNull()
  })
})

describe('usePlayer playback prewarm', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    vi.useFakeTimers()
    fetchMock = vi.fn().mockResolvedValue(new Response('x'))
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  // Pressing play on an AIFF transcodes the whole file before audio starts (Chromium
  // can't decode AIFF), so the first play of the default DJ format stalls. Warming
  // resolvePlayable for the rested selection runs that transcode ahead of time, so the
  // click-to-sound gap collapses to a cache hit.
  it('warms the resolved playable for the rested selection', () => {
    const t = track('t1', '/music/a.aiff')
    renderHook(() => usePlayer({ tracks: [t], selected: t, selectedId: t.id }))
    expect(fetchMock).not.toHaveBeenCalled()
    vi.advanceTimersByTime(400)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(mediaUrl(t.inputPath))
    // A 1-byte range still drives the full transcode in main, but pulls no payload.
    expect((init as RequestInit).headers).toMatchObject({ Range: 'bytes=0-0' })
  })

  // Arrowing through a crate must not transcode every row it passes — only where the
  // selection rests, or a fast j/k sweep would spawn an ffmpeg run per file.
  it('debounces so only the rested selection warms', () => {
    const a = track('a', '/music/a.aiff')
    const b = track('b', '/music/b.aiff')
    const { rerender } = renderHook(
      ({ sel }) => usePlayer({ tracks: [a, b], selected: sel, selectedId: sel.id }),
      { initialProps: { sel: a } },
    )
    vi.advanceTimersByTime(200)
    rerender({ sel: b })
    vi.advanceTimersByTime(400)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe(mediaUrl(b.inputPath))
  })

  it('does not warm when nothing is selected', () => {
    renderHook(() => usePlayer({ tracks: [], selected: null, selectedId: null }))
    vi.advanceTimersByTime(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// The invariant behind a whole class of recurring bugs ("the track sounds but the
// mini-player never appears"): whenever something is playing, the floating player must be
// visible — App renders it only on `playerVisible && playerTrack`, so any path that leaves
// playingId set while playerVisible is false plays audio with no card to see or pause it.
// These drive the real gestures (double-click a row, play one row while another is
// selected) and assert that invariant, so a future regression is caught as a class, not
// one leaked case at a time.
describe('usePlayer keeps the player visible while a track sounds', () => {
  // Exposes the hook's state and actions, and — like App — lets selected/selectedId change
  // independently of what is playing, which is exactly where the desync creeps in.
  function harness(initial: { tracks: TrackItem[]; selectedId: string | null }) {
    const api: { player: ReturnType<typeof usePlayer> | null } = { player: null }
    function Comp({
      tracks,
      selectedId,
    }: {
      tracks: TrackItem[]
      selectedId: string | null
    }): React.JSX.Element {
      const selected = tracks.find((t) => t.id === selectedId) ?? null
      const player = usePlayer({ tracks, selected, selectedId })
      api.player = player
      return (
        // biome-ignore lint/a11y/useMediaCaption: silent test fixture
        <audio ref={player.audioRef} data-testid="audio" />
      )
    }
    const view = render(<Comp {...initial} />)
    const audio = screen.getByTestId('audio') as HTMLAudioElement
    audio.play = vi.fn().mockResolvedValue(undefined)
    audio.pause = vi.fn()
    audio.load = vi.fn()
    return { api, view, audio, Comp }
  }

  // The invariant, one place: something is playing (playerTrack is set) → the card shows.
  function expectInvariant(player: ReturnType<typeof usePlayer>): void {
    const soundsSomething = player.playerTrack !== null && player.audioRef.current?.src
    if (soundsSomething) expect(player.playerVisible).toBe(true)
  }

  it('shows the player when a row is played while another row is selected', () => {
    const a = track('a', '/m/a.wav')
    const b = track('b', '/m/b.wav')
    const { api, view, Comp } = harness({ tracks: [a, b], selectedId: 'a' })

    // Play B (the row's own play button / double-click) while A stays selected — the
    // screenshot's exact shape: one row sounds, a different row is highlighted.
    act(() => api.player?.toggleTrack(b))
    // A selection-follow effect keys off selectedId; re-render with A still selected so it
    // runs against the just-started playback, the moment the desync used to appear.
    view.rerender(<Comp tracks={[a, b]} selectedId="a" />)

    // Something is loaded to play (the card has a track to show).
    expect(api.player?.playerTrack?.id ?? null).not.toBeNull()
    // biome-ignore lint/style/noNonNullAssertion: player is set after render
    expectInvariant(api.player!)
  })

  it('shows the player after double-clicking a row', () => {
    const a = track('a', '/m/a.wav')
    const { api } = harness({ tracks: [a], selectedId: 'a' })
    act(() => api.player?.toggleTrack(a))
    // biome-ignore lint/style/noNonNullAssertion: player is set after render
    expectInvariant(api.player!)
  })

  // The in-place-export restart path: while a track plays, exporting it in place rewrites
  // the file under the stream, and the watcher restarts playback from the new path — a
  // startPlayback that does NOT go through toggleTrack. The card must stay up through it.
  // The invariant living only in toggleTrack (not in startPlayback) is what let a restart
  // like this sound a track with the player gone; enforcing it in startPlayback fixes the
  // whole class, and this drives that exact path.
  it('stays visible when an in-place export restarts the playing track', () => {
    const a = track('a', '/m/a.wav')
    const { api, view, audio, Comp } = harness({ tracks: [a], selectedId: 'a' })

    act(() => api.player?.toggleTrack(a))
    // The file moves under the stream (in-place export renamed it); same id, new path.
    const moved = track('a', '/m/a-final.aiff')
    act(() => view.rerender(<Comp tracks={[moved]} selectedId="a" />))

    expect(audio.src).toContain('a-final.aiff')
    // biome-ignore lint/style/noNonNullAssertion: player is set after render
    expectInvariant(api.player!)
  })
})
