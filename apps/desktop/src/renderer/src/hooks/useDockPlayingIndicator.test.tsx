// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type React from 'react'
import { useRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateDockIconFrames } from '../lib/dockIcon'
import { useDockPlayingIndicator } from './useDockPlayingIndicator'

vi.mock('../lib/dockIcon', () => ({
  generateDockIconFrames: vi.fn(() =>
    Promise.resolve({ resting: 'data:resting', frames: ['data:frame0'] }),
  ),
}))

function setApi(platform: string): {
  setDockFrames: ReturnType<typeof vi.fn>
  setDockPlaying: ReturnType<typeof vi.fn>
} {
  const setDockFrames = vi.fn()
  const setDockPlaying = vi.fn()
  ;(window as unknown as { api: unknown }).api = { platform, setDockFrames, setDockPlaying }
  return { setDockFrames, setDockPlaying }
}

function Harness(): React.JSX.Element {
  const audioRef = useRef<HTMLAudioElement>(null)
  useDockPlayingIndicator(audioRef)
  // biome-ignore lint/a11y/useMediaCaption: silent test fixture
  return <audio ref={audioRef} data-testid="audio" />
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('useDockPlayingIndicator', () => {
  // The dock animation must mirror what is audible: any way playback starts or
  // stops (Space, selection change, track end) lands on the element's events.
  it('mirrors the audio element play and pause into the dock state', () => {
    const { setDockPlaying } = setApi('darwin')
    render(<Harness />)
    const audio = screen.getByTestId('audio')

    fireEvent.play(audio)
    expect(setDockPlaying).toHaveBeenLastCalledWith(true)

    fireEvent.pause(audio)
    expect(setDockPlaying).toHaveBeenLastCalledWith(false)
  })

  // Closing the player tears the element down with pause() + load(), and the media
  // load algorithm discards the queued pause event — so without watching the reset
  // itself, the Dock would keep animating after the player is closed.
  it('stops the dock animation when the element is reset', () => {
    const { setDockPlaying } = setApi('darwin')
    render(<Harness />)
    const audio = screen.getByTestId('audio')

    fireEvent.play(audio)
    fireEvent.emptied(audio)
    expect(setDockPlaying).toHaveBeenLastCalledWith(false)
  })

  // Main has no DOM to rasterize the SVG, so the renderer ships the frames up
  // front; without them main has nothing to cycle when play arrives.
  it('ships the rasterized icon frames to the main process', async () => {
    const { setDockFrames } = setApi('darwin')
    render(<Harness />)
    await waitFor(() =>
      expect(setDockFrames).toHaveBeenCalledWith({
        resting: 'data:resting',
        frames: ['data:frame0'],
      }),
    )
  })

  // app.dock only exists on macOS; off it, rasterizing twelve frames and sending
  // them over IPC would be pure waste.
  it('does nothing off macOS', () => {
    const { setDockFrames, setDockPlaying } = setApi('win32')
    render(<Harness />)

    fireEvent.play(screen.getByTestId('audio'))
    expect(generateDockIconFrames).not.toHaveBeenCalled()
    expect(setDockFrames).not.toHaveBeenCalled()
    expect(setDockPlaying).not.toHaveBeenCalled()
  })
})
