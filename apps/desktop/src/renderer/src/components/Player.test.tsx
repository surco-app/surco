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
  function audioEl(over: { currentTime?: number; duration?: number; paused?: boolean } = {}) {
    const audio = document.createElement('audio')
    Object.defineProperty(audio, 'currentTime', { value: over.currentTime ?? 0, writable: true })
    Object.defineProperty(audio, 'duration', { value: over.duration ?? 0, writable: true })
    Object.defineProperty(audio, 'paused', { value: over.paused ?? true, writable: true })
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
})
