// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TrackMetadata } from '../../../shared/types'
import type { TrackItem } from '../types'
import { LivePlayer, Player } from './Player'
import '../i18n'

afterEach(cleanup)

function track(
  over: Partial<Omit<TrackItem, 'meta'>> & { meta?: Partial<TrackMetadata> } = {},
): TrackItem {
  return {
    id: 't1',
    inputPath: '/music/t1.wav',
    fileName: 't1.wav',
    listLabel: 't1.wav',
    query: '',
    status: 'idle',
    ...over,
    meta: {
      title: 'Still Cant',
      artist: 'DJ Carlos',
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
      ...over.meta,
    },
  }
}

function props(over = {}) {
  return {
    track: track(),
    paused: false,
    loading: false,
    progress: 0,
    currentTime: 0,
    duration: 0,
    onToggle: vi.fn(),
    onSeek: vi.fn(),
    onClose: vi.fn(),
    ...over,
  }
}

describe('Player', () => {
  it('shows what is playing', () => {
    render(<Player {...props()} />)
    expect(screen.getByTestId('player-title')).toHaveTextContent('Still Cant')
    expect(screen.getByText('DJ Carlos')).toBeInTheDocument()
  })

  it('falls back to the file name when there is no title', () => {
    render(<Player {...props({ track: track({ meta: { title: '' } }) })} />)
    expect(screen.getByTestId('player-title')).toHaveTextContent('t1.wav')
  })

  it('toggles playback from the transport button', () => {
    const onToggle = vi.fn()
    render(<Player {...props({ onToggle })} />)
    fireEvent.click(screen.getByTestId('player-toggle'))
    expect(onToggle).toHaveBeenCalledOnce()
  })

  it('labels the transport for screen readers by playback state', () => {
    const { rerender } = render(<Player {...props({ paused: false })} />)
    expect(screen.getByTestId('player-toggle')).toHaveAccessibleName('Pause')
    rerender(<Player {...props({ paused: true })} />)
    expect(screen.getByTestId('player-toggle')).toHaveAccessibleName('Play')
  })

  // On a network drive the element can sit for seconds fetching data before any
  // sound comes out; without a spinner the player looks like it ignored the click.
  it('shows a spinner instead of the pause icon while the stream is buffering', () => {
    render(<Player {...props({ paused: false, loading: true })} />)
    expect(screen.getByTestId('player-loading')).toBeInTheDocument()
    expect(screen.getByTestId('player-toggle')).toHaveAttribute('aria-busy', 'true')
  })

  it('keeps the play icon while paused even if data is still loading', () => {
    render(<Player {...props({ paused: true, loading: true })} />)
    expect(screen.queryByTestId('player-loading')).not.toBeInTheDocument()
  })

  it('closes when the close control is clicked', () => {
    const onClose = vi.fn()
    render(<Player {...props({ onClose })} />)
    fireEvent.click(screen.getByTestId('player-close'))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('shows the elapsed and total time so the listener can place the track', () => {
    render(<Player {...props({ currentTime: 65, duration: 754 })} />)
    expect(screen.getByTestId('player-time')).toHaveTextContent('1:05 / 12:34')
  })

  // The scrubber is a pointer-only convenience by design. Advertising role="slider"
  // promised arrow-key control it never had; it now reports playback position as a
  // non-interactive progress bar so a screen reader states position without offering
  // an interaction that does nothing.
  it('exposes playback position as a progress bar, not an inoperable slider', () => {
    render(<Player {...props({ progress: 0.5 })} />)
    const bar = screen.getByTestId('player-seek')
    expect(bar).toHaveAttribute('role', 'progressbar')
    expect(bar).toHaveAttribute('aria-valuenow', '50')
    expect(bar).not.toHaveAttribute('tabindex')
  })

  it('seeks to the fraction of the bar the user clicks', () => {
    const onSeek = vi.fn()
    render(<Player {...props({ onSeek })} />)
    const bar = screen.getByTestId('player-seek')
    // jsdom reports a zero-size rect, so pin one down to make the math real.
    bar.getBoundingClientRect = () => ({ left: 0, width: 200 }) as DOMRect
    fireEvent.click(bar, { clientX: 50 })
    expect(onSeek).toHaveBeenCalledWith(0.25)
  })
})

describe('LivePlayer', () => {
  // The clock follows the <audio> element through its own events: this is what
  // lets the rest of the app stop re-rendering on every ~4Hz timeupdate.
  function audioEl(
    over: { currentTime?: number; duration?: number; paused?: boolean; readyState?: number } = {},
  ) {
    const audio = document.createElement('audio')
    Object.defineProperty(audio, 'currentTime', { value: over.currentTime ?? 0, writable: true })
    Object.defineProperty(audio, 'duration', { value: over.duration ?? 0, writable: true })
    Object.defineProperty(audio, 'paused', { value: over.paused ?? true, writable: true })
    Object.defineProperty(audio, 'readyState', { value: over.readyState ?? 0, writable: true })
    return audio
  }

  it('syncs the displayed time from the audio element on mount', () => {
    const audio = audioEl({ currentTime: 65, duration: 754 })
    const ref = createRef<HTMLAudioElement>()
    ;(ref as { current: HTMLAudioElement }).current = audio
    render(<LivePlayer track={track()} audioRef={ref} onClose={vi.fn()} />)
    expect(screen.getByTestId('player-time')).toHaveTextContent('1:05 / 12:34')
  })

  it('advances the time as the audio element fires timeupdate', () => {
    const audio = audioEl({ duration: 754 })
    const ref = createRef<HTMLAudioElement>()
    ;(ref as { current: HTMLAudioElement }).current = audio
    render(<LivePlayer track={track()} audioRef={ref} onClose={vi.fn()} />)
    act(() => {
      ;(audio as unknown as { currentTime: number }).currentTime = 65
      audio.dispatchEvent(new Event('timeupdate'))
    })
    expect(screen.getByTestId('player-time')).toHaveTextContent('1:05 / 12:34')
  })

  // The card can mount after play() was already called on a still-empty element
  // (typical on slow network drives), so the spinner must come from the element's
  // readyState, not from an event the card wasn't mounted to hear.
  it('shows the spinner on mount when play started but no data has arrived', () => {
    const audio = audioEl({ paused: false, readyState: 0 })
    const ref = createRef<HTMLAudioElement>()
    ;(ref as { current: HTMLAudioElement }).current = audio
    render(<LivePlayer track={track()} audioRef={ref} onClose={vi.fn()} />)
    expect(screen.getByTestId('player-loading')).toBeInTheDocument()
  })

  it('swaps the spinner for the pause icon once playback actually starts', () => {
    const audio = audioEl({ paused: false, readyState: 0 })
    const ref = createRef<HTMLAudioElement>()
    ;(ref as { current: HTMLAudioElement }).current = audio
    render(<LivePlayer track={track()} audioRef={ref} onClose={vi.fn()} />)
    act(() => audio.dispatchEvent(new Event('playing')))
    expect(screen.queryByTestId('player-loading')).not.toBeInTheDocument()
  })

  it('brings the spinner back when playback stalls waiting for data', () => {
    const audio = audioEl({ paused: false, readyState: 4 })
    const ref = createRef<HTMLAudioElement>()
    ;(ref as { current: HTMLAudioElement }).current = audio
    render(<LivePlayer track={track()} audioRef={ref} onClose={vi.fn()} />)
    expect(screen.queryByTestId('player-loading')).not.toBeInTheDocument()
    act(() => audio.dispatchEvent(new Event('waiting')))
    expect(screen.getByTestId('player-loading')).toBeInTheDocument()
  })
})
