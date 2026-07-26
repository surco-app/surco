// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type React from 'react'
import { createRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TrackMetadata, WaveformResult } from '../../../shared/types'
import { createQueryClient } from '../lib/queryClient'
import type { TrackItem } from '../types'
import { LivePlayer, Player } from './Player'
import '../i18n'

const wave: WaveformResult = {
  peaks: [0.2, 0.8, 0.5, 1],
  rms: [0.1, 0.4, 0.25, 0.5],
  durationSec: 60,
}

// The embedded waveform reads its envelope through React Query off window.api and
// draws to a canvas — both absent in jsdom, so stub the bridge and the 2D context.
beforeEach(() => {
  ;(window as unknown as { api: unknown }).api = {
    waveform: vi.fn().mockResolvedValue(wave),
    cancelAnalysis: vi.fn().mockResolvedValue(undefined),
  }
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

// Every render needs a QueryClient in context for the waveform's useQuery; a fresh
// client per render keeps the cache from leaking between tests. The wrapper option
// (not a wrapping element) is what makes rerender keep the provider in place.
function renderUI(ui: React.ReactElement): ReturnType<typeof render> {
  const client = createQueryClient()
  return render(ui, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  })
}

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
    currentTime: 0,
    duration: 0,
    audioRef: createRef<HTMLAudioElement>(),
    continuous: false,
    showWaveform: true,
    volume: 1,
    onToggle: vi.fn(),
    onScrub: vi.fn(),
    onSetVolume: vi.fn(),
    onToggleContinuous: vi.fn(),
    onToggleWaveform: vi.fn(),
    onReveal: vi.fn(),
    onClose: vi.fn(),
    ...over,
  }
}

describe('Player', () => {
  it('shows what is playing', () => {
    renderUI(<Player {...props()} />)
    expect(screen.getByTestId('player-title')).toHaveTextContent('Still Cant')
    expect(screen.getByText('DJ Carlos')).toBeInTheDocument()
  })

  it('falls back to the file name when there is no title', () => {
    renderUI(<Player {...props({ track: track({ meta: { title: '' } }) })} />)
    expect(screen.getByTestId('player-title')).toHaveTextContent('t1.wav')
  })

  // The player shows the track being played — the file's own art — so dropping a new
  // cover into the editor form never repaints the player. It reads embeddedCover (frozen
  // at import), not the live/edited coverUrl the form writes.
  it('shows the embedded cover, not the edited one from the form', () => {
    renderUI(
      <Player
        {...props({
          track: track({ embeddedCover: 'file:///original.jpg', coverUrl: 'blob:edited' }),
        })}
      />,
    )
    expect(screen.getByTestId('player-cover')).toHaveAttribute('src', 'file:///original.jpg')
  })

  // A file with no embedded art shows a plain brand-color label on the vinyl, not an
  // empty black square that reads as a broken image.
  it('shows a plain label placeholder when the track has no embedded cover', () => {
    renderUI(<Player {...props({ track: track({ embeddedCover: undefined }) })} />)
    expect(screen.queryByTestId('player-cover')).toBeNull()
    expect(screen.getByTestId('player-cover-placeholder')).toBeInTheDocument()
  })

  // The cover is drawn as a vinyl disc that spins while sound is actually coming out.
  // animation-play-state (not conditional animation) is the contract: pausing must freeze
  // the record in place like a real turntable, not snap it back to 0°.
  it('spins the vinyl while playing', () => {
    renderUI(<Player {...props({ paused: false, loading: false })} />)
    expect(screen.getByTestId('player-vinyl')).toHaveStyle({ animationPlayState: 'running' })
  })

  it('freezes the vinyl when paused', () => {
    renderUI(<Player {...props({ paused: true })} />)
    expect(screen.getByTestId('player-vinyl')).toHaveStyle({ animationPlayState: 'paused' })
  })

  // While buffering from a network drive no audio is advancing, so a spinning record
  // would claim playback that isn't happening.
  it('freezes the vinyl while loading', () => {
    renderUI(<Player {...props({ paused: false, loading: true })} />)
    expect(screen.getByTestId('player-vinyl')).toHaveStyle({ animationPlayState: 'paused' })
  })

  // Coverless tracks get the same disc with a plain label, so the player never regresses
  // to the old flat square just because a file has no art.
  it('renders the disc for coverless tracks too', () => {
    renderUI(<Player {...props({ track: track({ embeddedCover: undefined }) })} />)
    expect(screen.getByTestId('player-vinyl')).toBeInTheDocument()
    expect(screen.getByTestId('player-cover-placeholder')).toBeInTheDocument()
  })

  // The readout lives inside the popover, which only mounts while the user is actually
  // reaching for the volume — so it costs no permanent space and the exact figure is worth
  // showing at every level, full volume included.
  it('shows the volume readout at full volume', () => {
    renderUI(<Player {...props({ volume: 1 })} />)
    expect(screen.getByTestId('player-volume')).toHaveTextContent('100%')
  })

  it('shows the volume readout once it is turned down', () => {
    renderUI(<Player {...props({ volume: 0.5 })} />)
    expect(screen.getByTestId('player-volume')).toHaveTextContent('50%')
  })

  it('toggles playback from the transport button', () => {
    const onToggle = vi.fn()
    renderUI(<Player {...props({ onToggle })} />)
    fireEvent.click(screen.getByTestId('player-toggle'))
    expect(onToggle).toHaveBeenCalledOnce()
  })

  it('labels the transport for screen readers by playback state', () => {
    const { rerender } = renderUI(<Player {...props({ paused: false })} />)
    expect(screen.getByTestId('player-toggle')).toHaveAccessibleName('Pause')
    rerender(<Player {...props({ paused: true })} />)
    expect(screen.getByTestId('player-toggle')).toHaveAccessibleName('Play')
  })

  // On a network drive the element can sit for seconds fetching data before any
  // sound comes out; without a spinner the player looks like it ignored the click.
  it('shows a spinner instead of the pause icon while the stream is buffering', () => {
    renderUI(<Player {...props({ paused: false, loading: true })} />)
    expect(screen.getByTestId('player-loading')).toBeInTheDocument()
    expect(screen.getByTestId('player-toggle')).toHaveAttribute('aria-busy', 'true')
  })

  it('keeps the play icon while paused even if data is still loading', () => {
    renderUI(<Player {...props({ paused: true, loading: true })} />)
    expect(screen.queryByTestId('player-loading')).not.toBeInTheDocument()
  })

  it('closes when the close control is clicked', () => {
    const onClose = vi.fn()
    renderUI(<Player {...props({ onClose })} />)
    fireEvent.click(screen.getByTestId('player-close'))
    expect(onClose).toHaveBeenCalledOnce()
  })

  // After scrolling or selecting elsewhere the playing track can be off-screen, so the
  // player's locate control asks App to bring it back into the list.
  it('reveals the playing track when the locate control is clicked', () => {
    const onReveal = vi.fn()
    renderUI(<Player {...props({ onReveal })} />)
    fireEvent.click(screen.getByTestId('player-reveal'))
    expect(onReveal).toHaveBeenCalledOnce()
  })

  it('shows the elapsed and total time so the listener can place the track', () => {
    renderUI(<Player {...props({ currentTime: 65, duration: 754 })} />)
    expect(screen.getByTestId('player-time')).toHaveTextContent('1:05 / 12:34')
  })

  // The scrubber is now a waveform of the track rather than a thin bar, so the
  // listener seeks against the audio they can see instead of a featureless line.
  it('renders the waveform scrubber for the playing track', async () => {
    renderUI(<Player {...props()} />)
    expect(await screen.findByTestId('waveform')).toBeInTheDocument()
  })

  it('toggles continuous playback and reflects its state to screen readers', () => {
    // The icon is the only affordance for the mode, so it must announce whether
    // auto-advance is on (aria-pressed) and report the click to persist the choice.
    const onToggleContinuous = vi.fn()
    const { rerender } = renderUI(<Player {...props({ continuous: false, onToggleContinuous })} />)
    const toggle = screen.getByTestId('player-continuous')
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(toggle)
    expect(onToggleContinuous).toHaveBeenCalledOnce()
    rerender(<Player {...props({ continuous: true, onToggleContinuous })} />)
    expect(screen.getByTestId('player-continuous')).toHaveAttribute('aria-pressed', 'true')
  })

  // The waveform is the player's heaviest work (a full-file decode that reloads per track on
  // a network drive). Hiding it must remove the strip entirely — not just visually — so the
  // <Waveform> never mounts and never kicks off that decode.
  it('omits the waveform entirely when hidden so nothing is computed', () => {
    renderUI(<Player {...props({ showWaveform: false })} />)
    expect(screen.queryByTestId('waveform')).toBeNull()
  })

  // Hiding the waveform must not hide the transport facts: the volume and the elapsed/total
  // time the overlay used to carry stay on a slim row, so the player still tells you where
  // you are.
  it('keeps the volume and time on a compact row when the waveform is hidden', () => {
    renderUI(
      <Player {...props({ showWaveform: false, volume: 0.5, currentTime: 65, duration: 754 })} />,
    )
    expect(screen.queryByTestId('waveform')).toBeNull()
    expect(screen.getByTestId('player-time')).toHaveTextContent('1:05 / 12:34')
    // Volume is not duplicated on this row: the same speaker sits in the transport above in
    // both layouts, so the whole row width goes to the progress bar.
    expect(screen.getByTestId('player-volume-slider')).toHaveValue('0.5')
  })

  // That row keeps the track scrubbable without the waveform: a click seeks proportionally.
  it('seeks from the compact progress bar when the waveform is hidden', () => {
    const onScrub = vi.fn()
    renderUI(<Player {...props({ showWaveform: false, duration: 100, onScrub })} />)
    const bar = screen.getByTestId('player-seek')
    bar.getBoundingClientRect = () => ({ left: 0, width: 200 }) as DOMRect
    fireEvent.click(bar, { clientX: 100 })
    expect(onScrub).toHaveBeenCalledWith(50)
  })

  it('renders the waveform when shown', async () => {
    renderUI(<Player {...props({ showWaveform: true })} />)
    expect(await screen.findByTestId('waveform')).toBeInTheDocument()
  })

  // The on-player toggle is the only affordance for the preference, so it announces whether
  // the wave is shown (aria-pressed) and reports the click so App can persist the choice.
  it('toggles the waveform and reflects its state to screen readers', () => {
    const onToggleWaveform = vi.fn()
    const { rerender } = renderUI(<Player {...props({ showWaveform: true, onToggleWaveform })} />)
    const toggle = screen.getByTestId('player-waveform')
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(toggle)
    expect(onToggleWaveform).toHaveBeenCalledOnce()
    rerender(<Player {...props({ showWaveform: false, onToggleWaveform })} />)
    expect(screen.getByTestId('player-waveform')).toHaveAttribute('aria-pressed', 'false')
  })

  // Volume rides a real slider so it never collides with scrolling the track list:
  // dragging the range reports the new level to set the element volume.
  it('reports a new volume when the slider is dragged', () => {
    const onSetVolume = vi.fn()
    renderUI(<Player {...props({ volume: 1, onSetVolume })} />)
    fireEvent.change(screen.getByTestId('player-volume-slider'), { target: { value: '0.3' } })
    expect(onSetVolume).toHaveBeenCalledWith(0.3)
  })

  // The slider mirrors the live level so the control reflects the current volume.
  it('reflects the current volume on the slider', () => {
    renderUI(<Player {...props({ volume: 0.4 })} />)
    expect(screen.getByTestId('player-volume-slider')).toHaveValue('0.4')
  })

  // Volume lives on the transport row, never over the wave. Auditioning a track means
  // clicking along the waveform to jump around it, and a control floating on the wave
  // both hides the opening seconds and swallows the clicks meant for them — the one
  // gesture the player exists for. Nothing overlays the wave but the click-through clock.
  it('keeps the volume off the waveform so the whole wave stays scrubbable', () => {
    renderUI(<Player {...props()} />)
    const card = screen.getByTestId('player')
    fireEvent.pointerEnter(card)
    const wave = screen.getByTestId('waveform').parentElement
    expect(wave).not.toBeNull()
    expect(wave?.querySelector('[data-testid="player-volume-button"]')).toBeNull()
    expect(wave?.querySelector('[data-testid="player-volume-slider"]')).toBeNull()
  })

  // The clock may sit on the wave because it lets clicks through to the wave beneath;
  // that is the standard any wave overlay has to meet.
  it('lets clicks through the clock to the wave underneath', () => {
    renderUI(<Player {...props()} />)
    expect(screen.getByTestId('player-time')).toHaveClass('pointer-events-none')
  })

  // Close belongs to the card, not to the transport: dismissing the player is the standard
  // top-right affordance of any closable panel, and keeping it among the playback buttons
  // put an exit one stray click away from pause.
  it('keeps close out of the transport cluster', () => {
    renderUI(<Player {...props()} />)
    const transport = screen.getByTestId('player-toggle').parentElement
    expect(transport?.querySelector('[data-testid="player-close"]')).toBeNull()
  })

  it('still closes from the card corner', () => {
    const onClose = vi.fn()
    renderUI(<Player {...props({ onClose })} />)
    fireEvent.click(screen.getByTestId('player-close'))
    expect(onClose).toHaveBeenCalledOnce()
  })

  // The whole point of moving volume down here: it is on screen at all times, with no
  // hover and no popover, so the level is readable and adjustable in one gesture and can
  // never appear on top of the title or the wave the way a pop-out did.
  it('keeps the volume visible without any hover', () => {
    renderUI(<Player {...props({ volume: 0.7 })} />)
    expect(screen.getByTestId('player-volume-slider')).toHaveValue('0.7')
    expect(screen.getByTestId('player-volume')).toHaveTextContent('70%')
  })

  // Volume sits on the transport row, not on the title's line — sharing that line is what
  // squeezed a long title into an ellipsis.
  it('keeps the volume out of the title block', () => {
    renderUI(<Player {...props()} />)
    const titleBlock = screen.getByTestId('player-title').parentElement
    expect(titleBlock?.querySelector('[data-testid="player-volume-control"]')).toBeNull()
  })

  // Clicking the speaker mutes without hunting the slider to zero, and clicking again
  // restores the level it had — muting is a toggle, not a destroyed setting.
  it('mutes to silence and restores the previous level', () => {
    const onSetVolume = vi.fn()
    const { rerender } = renderUI(<Player {...props({ volume: 0.8, onSetVolume })} />)
    fireEvent.click(screen.getByTestId('player-volume-button'))
    expect(onSetVolume).toHaveBeenCalledWith(0)
    rerender(<Player {...props({ volume: 0, onSetVolume })} />)
    fireEvent.click(screen.getByTestId('player-volume-button'))
    expect(onSetVolume).toHaveBeenLastCalledWith(0.8)
  })

  // The speaker reports mute to assistive tech as state, not just as a changed glyph.
  it('marks the speaker as pressed while muted', () => {
    renderUI(<Player {...props({ volume: 0 })} />)
    expect(screen.getByTestId('player-volume-button')).toHaveAttribute('aria-pressed', 'true')
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
    renderUI(
      <LivePlayer
        track={track()}
        audioRef={ref}
        continuous={false}
        onToggleContinuous={vi.fn()}
        showWaveform={true}
        onToggleWaveform={vi.fn()}
        onReveal={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByTestId('player-time')).toHaveTextContent('1:05 / 12:34')
  })

  it('mirrors the slider onto the element volume when dragged', () => {
    const audio = audioEl()
    Object.defineProperty(audio, 'volume', { value: 1, writable: true })
    const ref = createRef<HTMLAudioElement>()
    ;(ref as { current: HTMLAudioElement }).current = audio
    renderUI(
      <LivePlayer
        track={track()}
        audioRef={ref}
        continuous={false}
        onToggleContinuous={vi.fn()}
        showWaveform={true}
        onToggleWaveform={vi.fn()}
        onReveal={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    fireEvent.change(screen.getByTestId('player-volume-slider'), { target: { value: '0.45' } })
    expect(audio.volume).toBeCloseTo(0.45, 5)
  })

  it('advances the time as the audio element fires timeupdate', () => {
    const audio = audioEl({ duration: 754 })
    const ref = createRef<HTMLAudioElement>()
    ;(ref as { current: HTMLAudioElement }).current = audio
    renderUI(
      <LivePlayer
        track={track()}
        audioRef={ref}
        continuous={false}
        onToggleContinuous={vi.fn()}
        showWaveform={true}
        onToggleWaveform={vi.fn()}
        onReveal={vi.fn()}
        onClose={vi.fn()}
      />,
    )
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
    renderUI(
      <LivePlayer
        track={track()}
        audioRef={ref}
        continuous={false}
        onToggleContinuous={vi.fn()}
        showWaveform={true}
        onToggleWaveform={vi.fn()}
        onReveal={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByTestId('player-loading')).toBeInTheDocument()
  })

  it('swaps the spinner for the pause icon once playback actually starts', () => {
    const audio = audioEl({ paused: false, readyState: 0 })
    const ref = createRef<HTMLAudioElement>()
    ;(ref as { current: HTMLAudioElement }).current = audio
    renderUI(
      <LivePlayer
        track={track()}
        audioRef={ref}
        continuous={false}
        onToggleContinuous={vi.fn()}
        showWaveform={true}
        onToggleWaveform={vi.fn()}
        onReveal={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    act(() => audio.dispatchEvent(new Event('playing')))
    expect(screen.queryByTestId('player-loading')).not.toBeInTheDocument()
  })

  it('brings the spinner back when playback stalls waiting for data', () => {
    const audio = audioEl({ paused: false, readyState: 4 })
    const ref = createRef<HTMLAudioElement>()
    ;(ref as { current: HTMLAudioElement }).current = audio
    renderUI(
      <LivePlayer
        track={track()}
        audioRef={ref}
        continuous={false}
        onToggleContinuous={vi.fn()}
        showWaveform={true}
        onToggleWaveform={vi.fn()}
        onReveal={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.queryByTestId('player-loading')).not.toBeInTheDocument()
    act(() => audio.dispatchEvent(new Event('waiting')))
    expect(screen.getByTestId('player-loading')).toBeInTheDocument()
  })
})
