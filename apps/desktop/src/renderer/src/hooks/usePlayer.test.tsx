// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
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
