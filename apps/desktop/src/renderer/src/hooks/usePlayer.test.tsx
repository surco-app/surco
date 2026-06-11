// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TrackMetadata } from '../../../shared/types'
import type { TrackItem } from '../types'
import { usePlayer } from './usePlayer'

afterEach(cleanup)

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
})
