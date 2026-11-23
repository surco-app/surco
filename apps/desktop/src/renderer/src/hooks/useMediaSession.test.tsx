// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import type React from 'react'
import { useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyMetadata } from '../../../shared/metadata'
import type { TrackItem } from '../types'
import { useMediaSession } from './useMediaSession'

type Handler = (details: { seekTime?: number }) => void

class FakeMetadata {
  constructor(init: Record<string, unknown>) {
    Object.assign(this, init)
  }
}

let session: { metadata: unknown; handlers: Map<string, Handler | null> }

beforeEach(() => {
  const handlers = new Map<string, Handler | null>()
  session = { metadata: null, handlers }
  Object.defineProperty(navigator, 'mediaSession', {
    configurable: true,
    value: {
      get metadata() {
        return session.metadata
      },
      set metadata(value: unknown) {
        session.metadata = value
      },
      setActionHandler: (action: string, handler: Handler | null) => handlers.set(action, handler),
    },
  })
  ;(globalThis as unknown as { MediaMetadata: unknown }).MediaMetadata = FakeMetadata
})

afterEach(() => {
  cleanup()
})

function track(overrides: Partial<TrackItem> = {}): TrackItem {
  return {
    id: 't1',
    inputPath: '/music/real-love.aiff',
    fileName: 'real-love.aiff',
    query: '',
    listLabel: 'Real Love',
    meta: { ...emptyMetadata(), title: 'Real Love', artist: '3 Ways', album: 'Real Love EP' },
    embeddedCover: 'data:image/jpeg;base64,AAAA',
    ...overrides,
  } as TrackItem
}

function Harness({
  playing,
  moveSelection = () => {},
}: {
  playing: TrackItem | null
  moveSelection?: (delta: number) => void
}): React.JSX.Element {
  const audioRef = useRef<HTMLAudioElement>(null)
  useMediaSession({ audioRef, track: playing, moveSelection })
  // biome-ignore lint/a11y/useMediaCaption: silent test fixture
  return <audio ref={audioRef} data-testid="audio" />
}

describe('useMediaSession', () => {
  // The macOS Now Playing menu (and the keyboard media keys, AirPods, Watch) shows what
  // the app reports: without it a DJ auditioning in Surco sees a nameless entry.
  it('reports the playing track with its cover to the system', () => {
    render(<Harness playing={track()} />)

    expect(session.metadata).toMatchObject({
      title: 'Real Love',
      artist: '3 Ways',
      album: 'Real Love EP',
      artwork: [{ src: 'data:image/jpeg;base64,AAAA' }],
    })
  })

  // An untagged file still has to read as something in the menu, the same name the
  // player card shows for it.
  it('falls back to the file name for an untagged track', () => {
    render(<Harness playing={track({ meta: emptyMetadata(), embeddedCover: undefined })} />)

    expect(session.metadata).toMatchObject({ title: 'real-love.aiff', artwork: [] })
  })

  // Closing the player must take Surco out of the menu, not leave the last track there.
  it('clears the report when nothing plays', () => {
    const { rerender } = render(<Harness playing={track()} />)
    rerender(<Harness playing={null} />)

    expect(session.metadata).toBeNull()
  })

  // Next and previous from the menu or the media keys step through the list like ↓/↑,
  // so the follow-selection playback plays the new row.
  it('steps the selection with next and previous', () => {
    const moveSelection = vi.fn()
    render(<Harness playing={track()} moveSelection={moveSelection} />)

    session.handlers.get('nexttrack')?.({})
    session.handlers.get('previoustrack')?.({})

    expect(moveSelection.mock.calls).toEqual([[1], [-1]])
  })

  // Dragging the system progress bar has to move the actual playhead.
  it('seeks the element to the time the system asks for', () => {
    render(<Harness playing={track()} />)
    const audio = screen.getByTestId('audio') as HTMLAudioElement

    session.handlers.get('seekto')?.({ seekTime: 42 })

    expect(audio.currentTime).toBe(42)
  })

  // With the player closed the menu must not offer controls that would start Surco again.
  it('drops its controls when nothing plays', () => {
    const { rerender } = render(<Harness playing={track()} />)
    rerender(<Harness playing={null} />)

    expect(session.handlers.get('nexttrack')).toBeNull()
    expect(session.handlers.get('previoustrack')).toBeNull()
    expect(session.handlers.get('seekto')).toBeNull()
  })
})
