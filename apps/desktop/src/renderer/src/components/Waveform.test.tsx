// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WaveformResult } from '../../../shared/types'
import { createQueryClient } from '../lib/queryClient'
import { drawWaveform } from '../lib/waveform'
import '../i18n'
import { Waveform } from './Waveform'

vi.mock('../lib/waveform', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../lib/waveform')>()
  return { ...mod, drawWaveform: vi.fn(mod.drawWaveform) }
})

const wave: WaveformResult = {
  peaks: [0.1, 0.9, 0.4, 1],
  rms: [0.05, 0.45, 0.2, 0.5],
  durationSec: 60,
}

function renderWithQuery(ui: React.ReactElement): ReturnType<typeof render> {
  const client = createQueryClient()
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

function setWaveform(result: WaveformResult | null): void {
  ;(window as unknown as { api: unknown }).api = {
    waveform: vi.fn().mockResolvedValue(result),
    cancelAnalysis: vi.fn().mockResolvedValue(undefined),
  }
}

// A decode that never settles: the peaks stay pending so the component renders its
// loading state, standing in for the seconds ffmpeg spends decoding a fresh file.
function setWaveformPending(): void {
  ;(window as unknown as { api: unknown }).api = {
    waveform: vi.fn().mockReturnValue(new Promise<WaveformResult>(() => {})),
    cancelAnalysis: vi.fn().mockResolvedValue(undefined),
  }
}

// jsdom implements neither PointerEvent nor pointer capture. Aliasing PointerEvent
// to MouseEvent lets fireEvent carry clientX (a MouseEvent field) into the handler;
// the capture stubs keep setPointerCapture/hasPointerCapture from throwing.
beforeEach(() => {
  ;(window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = window.MouseEvent
  HTMLElement.prototype.setPointerCapture = vi.fn()
  HTMLElement.prototype.hasPointerCapture = vi.fn().mockReturnValue(true)
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
    renderWithQuery(<Waveform inputPath="/m/a.wav" active={false} onScrub={onScrub} />)
    const strip = await screen.findByTestId('waveform')
    // With no <audio> duration to lean on, the strip maps clicks once the decoded
    // peaks land (which carry the duration), so wait for the skeleton to clear.
    await waitFor(() => expect(screen.queryByTestId('waveform-loading')).not.toBeInTheDocument())
    strip.getBoundingClientRect = () =>
      ({ left: 0, width: 1000, top: 0, height: 96, right: 1000, bottom: 96, x: 0, y: 0 }) as DOMRect
    fireEvent.pointerDown(strip, { clientX: 250, pointerId: 1 })
    expect(onScrub).toHaveBeenCalledWith(15)
  })

  // The strip's bars must follow the theme accent instead of a hard-coded blue: the
  // fixed rgba(96,165,250) washed out against the light theme's pale panels. The theme
  // lives only in <html data-theme> (no React store), so the strip re-reads the token
  // and repaints when that attribute flips mid-session.
  it('paints the bars with the theme accent and repaints on theme change', async () => {
    setWaveform(wave)
    document.documentElement.style.setProperty('--color-accent', '#2959aa')
    try {
      renderWithQuery(<Waveform inputPath="/m/a.wav" active={false} onScrub={vi.fn()} />)
      await waitFor(() =>
        expect(drawWaveform).toHaveBeenCalledWith(
          expect.anything(),
          wave.peaks,
          expect.objectContaining({ color: 'rgba(41, 89, 170, 0.8)' }),
        ),
      )
      document.documentElement.style.setProperty('--color-accent', '#7aa2f7')
      document.documentElement.setAttribute('data-theme', 'dark')
      await waitFor(() =>
        expect(drawWaveform).toHaveBeenCalledWith(
          expect.anything(),
          wave.peaks,
          expect.objectContaining({ color: 'rgba(122, 162, 247, 0.8)' }),
        ),
      )
    } finally {
      document.documentElement.style.removeProperty('--color-accent')
      document.documentElement.removeAttribute('data-theme')
    }
  })

  it('scrubs against the playback duration before the peaks finish decoding', async () => {
    // The full-file decode takes seconds; a DJ must be able to seek the instant the
    // <audio> element reports a duration, so the strip uses that rather than waiting
    // for the peaks to map a click to a time.
    const onScrub = vi.fn()
    setWaveformPending()
    renderWithQuery(
      <Waveform inputPath="/m/a.wav" active={false} audioDurationSec={60} onScrub={onScrub} />,
    )
    const strip = await screen.findByTestId('waveform')
    strip.getBoundingClientRect = () =>
      ({ left: 0, width: 1000, top: 0, height: 96, right: 1000, bottom: 96, x: 0, y: 0 }) as DOMRect
    fireEvent.pointerDown(strip, { clientX: 250, pointerId: 1 })
    expect(onScrub).toHaveBeenCalledWith(15)
  })

  it('marks the strip as loading while the peaks decode', async () => {
    // The decode shows a placeholder so the few seconds it takes read as "loading",
    // not a broken, empty player — drawn through the same canvas raster as the real
    // strip so it previews the wave to come instead of a row of blocks.
    setWaveformPending()
    renderWithQuery(
      <Waveform inputPath="/m/a.wav" active={false} audioDurationSec={60} onScrub={vi.fn()} />,
    )
    expect((await screen.findByTestId('waveform-loading')).tagName).toBe('CANVAS')
  })

  it('shows the playhead at the playback position only while this track is active', async () => {
    // The playhead must reflect the shared player's clock — but only when that
    // player is streaming this track, so it never maps another track's time here.
    // The clock arrives as a prop: the card above owns the one timeupdate listener.
    setWaveform(wave)
    renderWithQuery(<Waveform inputPath="/m/a.wav" active playheadSec={15} onScrub={vi.fn()} />)
    const playhead = await screen.findByTestId('waveform-playhead')
    // 15 s of 60 s → a quarter of the way across. The position rides a transform on the
    // full-width carrier (not `left`) so each timeupdate composites instead of relayouts.
    expect(playhead.parentElement).toHaveStyle({ transform: 'translateX(25%)' })
  })

  it('hides the playhead when another track (or none) is playing', async () => {
    setWaveform(wave)
    renderWithQuery(<Waveform inputPath="/m/a.wav" active={false} onScrub={vi.fn()} />)
    await screen.findByTestId('waveform')
    expect(screen.queryByTestId('waveform-playhead')).not.toBeInTheDocument()
    // With no playback here there is no "played" portion either: the full-strength
    // layer clips to nothing and only the dimmed wave shows.
    expect(screen.getByTestId('waveform-played')).toHaveStyle({ clipPath: 'inset(0 100% 0 0)' })
  })

  it('paints the played portion full-strength over a dimmed remainder', async () => {
    // Progress must read peripherally — the played/pending contrast (the
    // SoundCloud/Serato convention) — instead of forcing the eye to hunt for the
    // 2px playhead line on a uniform strip.
    setWaveform(wave)
    // Earlier tests drew the same shared envelope; drop their calls so the counts
    // below see only this render.
    vi.mocked(drawWaveform).mockClear()
    renderWithQuery(<Waveform inputPath="/m/a.wav" active playheadSec={15} onScrub={vi.fn()} />)
    // 15 s of 60 s → the full-strength layer keeps the left quarter; the inset trims
    // the pending 75% off its right edge. A clip-path tween composites at ~4 Hz
    // without redrawing the canvas, like the playhead's translateX.
    const played = await screen.findByTestId('waveform-played')
    await waitFor(() => expect(played).toHaveStyle({ clipPath: 'inset(0 75% 0 0)' }))
    // Both layers carry the same envelope, drawn once each; the pending side dims via
    // CSS opacity rather than a second colour, so the two can never disagree. The
    // skeleton also funnels through drawWaveform, so count only the real envelope.
    const envelopeCalls = (): Parameters<typeof drawWaveform>[] =>
      vi.mocked(drawWaveform).mock.calls.filter((c) => c[1] === wave.peaks)
    await waitFor(() => expect(envelopeCalls()).toHaveLength(2))
    const [dimCall, playedCall] = envelopeCalls()
    expect(playedCall[2]).toEqual(dimCall[2])
  })

  it('previews the seek target under the cursor before the click commits', async () => {
    // Scrubbing is a precision gesture: the ghost line and its time bubble tell the
    // DJ which second a click will land on, instead of seek-and-listen roulette.
    setWaveform(wave)
    renderWithQuery(<Waveform inputPath="/m/a.wav" active={false} onScrub={vi.fn()} />)
    const strip = await screen.findByTestId('waveform')
    await waitFor(() => expect(screen.queryByTestId('waveform-loading')).not.toBeInTheDocument())
    strip.getBoundingClientRect = () =>
      ({ left: 0, width: 1000, top: 0, height: 96, right: 1000, bottom: 96, x: 0, y: 0 }) as DOMRect
    // A quarter of the way across a 60 s track → the bubble promises 0:15 and the
    // ghost line rides the same transform carrier the playhead uses.
    fireEvent.pointerMove(strip, { clientX: 250, pointerId: 1 })
    expect(screen.getByTestId('waveform-hover-time')).toHaveTextContent('0:15')
    expect(screen.getByTestId('waveform-hover').parentElement).toHaveStyle({
      transform: 'translateX(25%)',
    })
    // Off the strip, the preview goes with it — the resting card shows no ghost.
    fireEvent.pointerLeave(strip)
    expect(screen.queryByTestId('waveform-hover')).not.toBeInTheDocument()
  })

  it('renders nothing when the file has no decodable audio', async () => {
    // A null envelope means ffmpeg decoded nothing; drawing an empty strip would
    // imply a zero-length track instead of "no waveform".
    setWaveform(null)
    const { container } = renderWithQuery(
      <Waveform inputPath="/m/a.wav" active={false} onScrub={vi.fn()} />,
    )
    await waitFor(() => expect(screen.queryByTestId('waveform-loading')).not.toBeInTheDocument())
    expect(screen.queryByTestId('waveform')).not.toBeInTheDocument()
    expect(container).toBeEmptyDOMElement()
  })

  // The raster is scaled by CSS to the strip's height, so it has to stay exactly twice
  // that height to land 1:1 on device pixels of a @2x display. Change the strip without
  // the raster and the wave is resampled at a fractional ratio — visibly soft, and the
  // kind of regression nobody spots in a screenshot.
  it('keeps the raster at exactly twice the strip height', async () => {
    setWaveform(wave)
    renderWithQuery(<Waveform inputPath="/m/a.wav" active={false} onScrub={vi.fn()} />)
    const canvas = await screen.findByTestId('waveform')
    const strip = canvas.querySelector('canvas')
    expect(strip).not.toBeNull()
    expect(strip).toHaveClass('h-12')
    expect(strip).toHaveAttribute('height', '96')
  })
})
