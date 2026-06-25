// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WaveformResult } from '../../../shared/types'
import '../i18n'
import { Waveform } from './Waveform'

const wave: WaveformResult = { peaks: [0.1, 0.9, 0.4, 1], durationSec: 60 }

function renderWithQuery(ui: React.ReactElement): ReturnType<typeof render> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

function setWaveform(result: WaveformResult | null): void {
  ;(window as unknown as { api: unknown }).api = {
    waveform: vi.fn().mockResolvedValue(result),
  }
}

// A decode that never settles: the peaks stay pending so the component renders its
// loading state, standing in for the seconds ffmpeg spends decoding a fresh file.
function setWaveformPending(): void {
  ;(window as unknown as { api: unknown }).api = {
    waveform: vi.fn().mockReturnValue(new Promise<WaveformResult>(() => {})),
  }
}

// jsdom implements neither PointerEvent nor pointer capture. Aliasing PointerEvent
// to MouseEvent lets fireEvent carry clientX (a MouseEvent field) into the handler;
// the capture stubs keep setPointerCapture/hasPointerCapture from throwing.
beforeEach(() => {
  ;(window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = window.MouseEvent
  HTMLElement.prototype.setPointerCapture = vi.fn()
  HTMLElement.prototype.hasPointerCapture = vi.fn().mockReturnValue(true)
  // jsdom has no 2D canvas context (it logs a not-implemented error and returns
  // null); drawWaveform already handles null, so stub it to keep the noise out.
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Waveform', () => {
  it('maps a click position to a seek time so the DJ jumps to the spot they see', async () => {
    // The whole point of a waveform over a bare progress bar is spatial: a click a
    // quarter of the way across a 60 s track must request 15 s, not "play from 0".
    const onScrub = vi.fn()
    setWaveform(wave)
    renderWithQuery(
      <Waveform
        inputPath="/m/a.wav"
        audioRef={{ current: null }}
        active={false}
        onScrub={onScrub}
      />,
    )
    const strip = await screen.findByTestId('waveform')
    // With no <audio> duration to lean on, the strip maps clicks once the decoded
    // peaks land (which carry the duration), so wait for the skeleton to clear.
    await waitFor(() => expect(screen.queryByTestId('waveform-loading')).not.toBeInTheDocument())
    strip.getBoundingClientRect = () =>
      ({ left: 0, width: 1000, top: 0, height: 96, right: 1000, bottom: 96, x: 0, y: 0 }) as DOMRect
    fireEvent.pointerDown(strip, { clientX: 250, pointerId: 1 })
    expect(onScrub).toHaveBeenCalledWith(15)
  })

  it('scrubs against the playback duration before the peaks finish decoding', async () => {
    // The full-file decode takes seconds; a DJ must be able to seek the instant the
    // <audio> element reports a duration, so the strip uses that rather than waiting
    // for the peaks to map a click to a time.
    const onScrub = vi.fn()
    setWaveformPending()
    renderWithQuery(
      <Waveform
        inputPath="/m/a.wav"
        audioRef={{ current: null }}
        active={false}
        audioDurationSec={60}
        onScrub={onScrub}
      />,
    )
    const strip = await screen.findByTestId('waveform')
    strip.getBoundingClientRect = () =>
      ({ left: 0, width: 1000, top: 0, height: 96, right: 1000, bottom: 96, x: 0, y: 0 }) as DOMRect
    fireEvent.pointerDown(strip, { clientX: 250, pointerId: 1 })
    expect(onScrub).toHaveBeenCalledWith(15)
  })

  it('marks the strip as loading while the peaks decode', async () => {
    // The decode shows a placeholder so the few seconds it takes read as "loading",
    // not a broken, empty player.
    setWaveformPending()
    renderWithQuery(
      <Waveform
        inputPath="/m/a.wav"
        audioRef={{ current: null }}
        active={false}
        audioDurationSec={60}
        onScrub={vi.fn()}
      />,
    )
    expect(await screen.findByTestId('waveform-loading')).toBeInTheDocument()
  })

  it('shows the playhead at the playback position only while this track is active', async () => {
    // The playhead must reflect the shared player's clock — but only when that
    // player is streaming this track, so it never maps another track's time here.
    const audio = {
      currentTime: 15,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as HTMLAudioElement
    setWaveform(wave)
    renderWithQuery(
      <Waveform inputPath="/m/a.wav" audioRef={{ current: audio }} active onScrub={vi.fn()} />,
    )
    const playhead = await screen.findByTestId('waveform-playhead')
    // 15 s of 60 s → a quarter of the way across.
    expect(playhead).toHaveStyle({ left: '25%' })
  })

  it('hides the playhead when another track (or none) is playing', async () => {
    setWaveform(wave)
    renderWithQuery(
      <Waveform
        inputPath="/m/a.wav"
        audioRef={{ current: null }}
        active={false}
        onScrub={vi.fn()}
      />,
    )
    await screen.findByTestId('waveform')
    expect(screen.queryByTestId('waveform-playhead')).not.toBeInTheDocument()
  })

  it('renders nothing when the file has no decodable audio', async () => {
    // A null envelope means ffmpeg decoded nothing; drawing an empty strip would
    // imply a zero-length track instead of "no waveform".
    setWaveform(null)
    const { container } = renderWithQuery(
      <Waveform
        inputPath="/m/a.wav"
        audioRef={{ current: null }}
        active={false}
        onScrub={vi.fn()}
      />,
    )
    await waitFor(() => expect(screen.queryByTestId('waveform-loading')).not.toBeInTheDocument())
    expect(screen.queryByTestId('waveform')).not.toBeInTheDocument()
    expect(container).toBeEmptyDOMElement()
  })
})
