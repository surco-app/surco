// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NormalizeConfig, WaveformResult } from '../../../shared/types'
import '../i18n'
import { WaveformCompare, WaveformSolo } from './WaveformCompare'

const wave: WaveformResult = { peaks: [0.1, 0.9, 0.4, 1], durationSec: 60 }

const CFG_NONE: NormalizeConfig = { mode: 'none', targetLufs: -14, truePeakDb: -1, peakDb: -1 }

function renderWithQuery(ui: React.ReactElement): ReturnType<typeof render> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

beforeEach(() => {
  // jsdom has no 2D canvas context (it logs a not-implemented error and returns
  // null); the draw helper already handles null, so stub it to keep the noise out.
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null)
  // jsdom implements no PointerEvent either; aliasing it to MouseEvent lets fireEvent
  // carry clientX into the hover-readout handler (same trick as Waveform.test).
  ;(window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = window.MouseEvent
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('WaveformCompare', () => {
  // The whole point of the pair: the "after" strip must decode the converted file,
  // not re-show the source — that's how a DJ sees what normalization actually did.
  it('decodes and labels both the source and the converted file', async () => {
    const waveform = vi.fn().mockResolvedValue(wave)
    ;(window as unknown as { api: unknown }).api = { waveform }
    renderWithQuery(<WaveformCompare inputPath="/m/a.wav" outputPath="/out/a.aiff" enabled />)
    expect(await screen.findByTestId('waveform-compare')).toBeInTheDocument()
    expect(screen.getByTestId('waveform-before')).toBeInTheDocument()
    expect(screen.getByTestId('waveform-after')).toBeInTheDocument()
    await waitFor(() => expect(waveform).toHaveBeenCalledWith('/out/a.aiff'))
    expect(waveform).toHaveBeenCalledWith('/m/a.wav')
  })

  it('shows a decoding skeleton per strip while the peaks are pending', async () => {
    ;(window as unknown as { api: unknown }).api = {
      waveform: vi.fn().mockReturnValue(new Promise<WaveformResult>(() => {})),
    }
    renderWithQuery(<WaveformCompare inputPath="/m/a.wav" outputPath="/out/a.aiff" enabled />)
    expect(await screen.findAllByTestId('waveform-compare-loading')).toHaveLength(2)
  })

  // The full-length decode is the heaviest analysis; a folded-away section must not
  // pay for it. Mirrors the spectrogram/loudness gating in QualitySection.
  it('does not decode while disabled', async () => {
    const waveform = vi.fn().mockResolvedValue(wave)
    ;(window as unknown as { api: unknown }).api = { waveform }
    renderWithQuery(
      <WaveformCompare inputPath="/m/a.wav" outputPath="/out/a.aiff" enabled={false} />,
    )
    await waitFor(() => expect(screen.getByTestId('waveform-compare')).toBeInTheDocument())
    expect(waveform).not.toHaveBeenCalled()
  })

  // Djotas's ask behind the whole block: after converting, the figures must be the
  // OUTPUT's real measurement, not the source's — that's how you know what
  // normalization actually applied. Each legend carries its own file's numbers.
  it('shows each file’s measured loudness in its legend', async () => {
    const loudness = vi.fn(async (path: string) => ({
      integratedLufs: path === '/out/a.aiff' ? -9.2 : -21.8,
      truePeakDb: path === '/out/a.aiff' ? -0.8 : -18.1,
      lra: 0,
      channelBalanceDb: null,
      dcOffset: null,
      noiseFloorDb: null,
      crestDb: null,
    }))
    ;(window as unknown as { api: unknown }).api = {
      waveform: vi.fn().mockResolvedValue(wave),
      loudness,
    }
    renderWithQuery(<WaveformCompare inputPath="/m/a.wav" outputPath="/out/a.aiff" enabled />)
    const before = await screen.findByTestId('waveform-before')
    const after = screen.getByTestId('waveform-after')
    await waitFor(() => expect(before).toHaveTextContent('-21.8 LUFS · -18.1 dBTP'))
    expect(after).toHaveTextContent('-9.2 LUFS · -0.8 dBTP')
  })

  // GitHub-style image diff: besides side-by-side, an overlaid view draws both
  // envelopes on one canvas so the gain difference reads directly — the legends
  // (and their figures) stay up regardless of the view.
  it('switches to an overlaid single canvas and back', async () => {
    ;(window as unknown as { api: unknown }).api = {
      waveform: vi.fn().mockResolvedValue(wave),
      loudness: vi.fn().mockResolvedValue(null),
    }
    renderWithQuery(<WaveformCompare inputPath="/m/a.wav" outputPath="/out/a.aiff" enabled />)
    expect(await screen.findByTestId('waveform-side')).toBeInTheDocument()
    expect(screen.queryByTestId('waveform-overlay')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('waveform-view-overlay'))
    expect(screen.getByTestId('waveform-overlay')).toBeInTheDocument()
    expect(screen.queryByTestId('waveform-side')).not.toBeInTheDocument()
    expect(screen.getByTestId('waveform-before')).toBeInTheDocument()
    expect(screen.getByTestId('waveform-after')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('waveform-view-side'))
    expect(screen.getByTestId('waveform-side')).toBeInTheDocument()
  })

  // On barely-changed audio the two envelopes cover each other and the overlay reads
  // as one wave — GitHub's onion-skin answer: a fade slider that crossfades the
  // "after" layer over the "before", so scrubbing it makes the difference move.
  it('offers an onion-skin fade slider in the overlaid view only', async () => {
    ;(window as unknown as { api: unknown }).api = {
      waveform: vi.fn().mockResolvedValue(wave),
      loudness: vi.fn().mockResolvedValue(null),
    }
    renderWithQuery(<WaveformCompare inputPath="/m/a.wav" outputPath="/out/a.aiff" enabled />)
    await screen.findByTestId('waveform-side')
    expect(screen.queryByTestId('waveform-overlay-fade')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('waveform-view-overlay'))
    const fade = screen.getByTestId('waveform-overlay-fade') as HTMLInputElement
    expect(fade.value).toBe('0.5')
    fireEvent.change(fade, { target: { value: '0' } })
    expect(fade.value).toBe('0')
  })
})

// The pre-conversion view: the source's wave alone, with the same measured figures,
// so the normalization controls are tuned against what the file actually looks like.
describe('WaveformSolo', () => {
  it('decodes the source and shows its measured figures', async () => {
    const waveform = vi.fn().mockResolvedValue(wave)
    const loudness = vi.fn().mockResolvedValue({
      integratedLufs: -7.4,
      truePeakDb: 0.2,
      lra: 0,
      channelBalanceDb: null,
      dcOffset: null,
      noiseFloorDb: null,
      crestDb: null,
    })
    ;(window as unknown as { api: unknown }).api = { waveform, loudness }
    renderWithQuery(<WaveformSolo inputPath="/m/a.wav" enabled clipDb={-1} normalize={CFG_NONE} />)
    const solo = await screen.findByTestId('waveform-solo')
    await waitFor(() => expect(solo).toHaveTextContent('-7.4 LUFS · 0.2 dBTP'))
    expect(waveform).toHaveBeenCalledWith('/m/a.wav')
  })

  it('does not decode while disabled', async () => {
    const waveform = vi.fn().mockResolvedValue(wave)
    ;(window as unknown as { api: unknown }).api = {
      waveform,
      loudness: vi.fn().mockResolvedValue(null),
    }
    renderWithQuery(<WaveformSolo inputPath="/m/a.wav" enabled={false} clipDb={-1} normalize={CFG_NONE} />)
    await waitFor(() => expect(screen.getByTestId('waveform-solo')).toBeInTheDocument())
    expect(waveform).not.toHaveBeenCalled()
  })

  // Djotas's peaks: the strip marks where the wave pokes over the active ceiling in
  // red, and the legend names the ceiling so the marks aren't a mystery color. No
  // clipping peak, no legend — a clean track must not warn.
  it('flags peaks over the ceiling in the legend', async () => {
    ;(window as unknown as { api: unknown }).api = {
      // 1.0 and 0.9 poke over -1 dB (0.891); the label carries the ceiling value.
      waveform: vi.fn().mockResolvedValue({ peaks: [0.1, 0.9, 0.4, 1], durationSec: 60 }),
      loudness: vi.fn().mockResolvedValue(null),
    }
    renderWithQuery(<WaveformSolo inputPath="/m/a.wav" enabled clipDb={-1} normalize={CFG_NONE} />)
    expect(await screen.findByTestId('waveform-clipped')).toHaveTextContent('-1')
  })

  it('shows no clip flag when the wave stays under the ceiling', async () => {
    ;(window as unknown as { api: unknown }).api = {
      waveform: vi.fn().mockResolvedValue({ peaks: [0.1, 0.5, 0.4], durationSec: 60 }),
      loudness: vi.fn().mockResolvedValue(null),
    }
    renderWithQuery(<WaveformSolo inputPath="/m/a.wav" enabled clipDb={-1} normalize={CFG_NONE} />)
    await screen.findByTestId('waveform-solo')
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByTestId('waveform-clipped')).not.toBeInTheDocument()
  })

  // The legend doubles as the switch: a click hides the red marks (a busy vinyl rip
  // can be mostly red), another brings them back. The label stays up either way so
  // the way back is obvious.
  it('toggles the clip marks from the legend', async () => {
    ;(window as unknown as { api: unknown }).api = {
      waveform: vi.fn().mockResolvedValue(wave),
      loudness: vi.fn().mockResolvedValue(null),
    }
    renderWithQuery(<WaveformSolo inputPath="/m/a.wav" enabled clipDb={-1} normalize={CFG_NONE} />)
    const flag = await screen.findByTestId('waveform-clipped')
    expect(flag).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(flag)
    expect(screen.getByTestId('waveform-clipped')).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(screen.getByTestId('waveform-clipped'))
    expect(screen.getByTestId('waveform-clipped')).toHaveAttribute('aria-pressed', 'true')
  })

  // Hovering the strip reads out the exact spot: the time under the cursor and that
  // bucket's level in dB — red when it pokes over the active ceiling — so a DJ can
  // pin down where a clip sits without converting or opening the player.
  it('reads out time and level under the cursor', async () => {
    ;(window as unknown as { api: unknown }).api = {
      waveform: vi.fn().mockResolvedValue(wave),
      loudness: vi.fn().mockResolvedValue(null),
    }
    renderWithQuery(<WaveformSolo inputPath="/m/a.wav" enabled clipDb={-1} normalize={CFG_NONE} />)
    const strip = await screen.findByTestId('waveform-strip')
    // Hovering before the decode lands has nothing to read out; wait for the peaks.
    await waitFor(() =>
      expect(screen.queryByTestId('waveform-compare-loading')).not.toBeInTheDocument(),
    )
    strip.getBoundingClientRect = () =>
      ({ left: 0, width: 200, top: 0, height: 48, right: 200, bottom: 48, x: 0, y: 0 }) as DOMRect
    fireEvent.pointerMove(strip, { clientX: 150 })
    const readout = screen.getByTestId('waveform-hover')
    // 75% of 60 s = 0:45; bucket 3 of [0.1, 0.9, 0.4, 1] = 1.0 → 0.0 dB.
    expect(readout).toHaveTextContent('0:45')
    expect(readout).toHaveTextContent('0.0 dB')

    fireEvent.pointerLeave(strip)
    expect(screen.queryByTestId('waveform-hover')).not.toBeInTheDocument()
  })

  // With Loudness or Peak dialed in, the strip previews the outcome before any
  // conversion: the original stays behind in grey, the predicted envelope draws in
  // front, and the legend names the target it aims for.
  it('previews the loudness outcome over the original once measured', async () => {
    ;(window as unknown as { api: unknown }).api = {
      waveform: vi.fn().mockResolvedValue(wave),
      loudness: vi.fn().mockResolvedValue({
        integratedLufs: -20,
        truePeakDb: -8,
        lra: 0,
        channelBalanceDb: null,
        dcOffset: null,
        noiseFloorDb: null,
        crestDb: null,
      }),
    }
    renderWithQuery(
      <WaveformSolo
        inputPath="/m/a.wav"
        enabled
        clipDb={-1}
        normalize={{ mode: 'loudness', targetLufs: -14, truePeakDb: -1, peakDb: -1 }}
      />,
    )
    const legend = await screen.findByTestId('waveform-preview')
    expect(legend).toHaveTextContent('-14.0 LUFS')
    expect(legend).toHaveTextContent('-1.0 dBTP')
    // The felt number: how hard the normalization pushes (-20 measured to -14).
    expect(legend).toHaveTextContent('+6.0 dB')
  })

  it('shows no preview while normalization is off', async () => {
    ;(window as unknown as { api: unknown }).api = {
      waveform: vi.fn().mockResolvedValue(wave),
      loudness: vi.fn().mockResolvedValue(null),
    }
    renderWithQuery(<WaveformSolo inputPath="/m/a.wav" enabled clipDb={-1} normalize={CFG_NONE} />)
    await screen.findByTestId('waveform-solo')
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByTestId('waveform-preview')).not.toBeInTheDocument()
  })

  // rekordbox-style zoom: + stretches the strip inside a horizontal scroller so a
  // clip can be pinned down bar by bar; − steps back; the ×N label resets. The
  // envelope is still the decoded 2048 buckets — zoom widens them, it never re-reads.
  it('zooms the strip in steps and scrolls horizontally', async () => {
    ;(window as unknown as { api: unknown }).api = {
      waveform: vi.fn().mockResolvedValue(wave),
      loudness: vi.fn().mockResolvedValue(null),
    }
    renderWithQuery(<WaveformSolo inputPath="/m/a.wav" enabled clipDb={-1} normalize={CFG_NONE} />)
    const strip = await screen.findByTestId('waveform-strip')
    expect(strip).toHaveStyle({ width: '100%' })
    expect(screen.getByTestId('waveform-zoom-out')).toBeDisabled()

    fireEvent.click(screen.getByTestId('waveform-zoom-in'))
    expect(screen.getByTestId('waveform-strip')).toHaveStyle({ width: '200%' })

    fireEvent.click(screen.getByTestId('waveform-zoom-in'))
    fireEvent.click(screen.getByTestId('waveform-zoom-in'))
    expect(screen.getByTestId('waveform-strip')).toHaveStyle({ width: '800%' })
    expect(screen.getByTestId('waveform-zoom-in')).toBeDisabled()

    fireEvent.click(screen.getByTestId('waveform-zoom-out'))
    expect(screen.getByTestId('waveform-strip')).toHaveStyle({ width: '400%' })
  })

  it('resets the zoom from the factor label', async () => {
    ;(window as unknown as { api: unknown }).api = {
      waveform: vi.fn().mockResolvedValue(wave),
      loudness: vi.fn().mockResolvedValue(null),
    }
    renderWithQuery(<WaveformSolo inputPath="/m/a.wav" enabled clipDb={-1} normalize={CFG_NONE} />)
    await screen.findByTestId('waveform-strip')
    expect(screen.getByTestId('waveform-zoom-reset')).toBeDisabled()
    fireEvent.click(screen.getByTestId('waveform-zoom-in'))
    fireEvent.click(screen.getByTestId('waveform-zoom-in'))
    const reset = screen.getByTestId('waveform-zoom-reset')
    expect(reset).toHaveTextContent('×4')
    fireEvent.click(reset)
    expect(screen.getByTestId('waveform-strip')).toHaveStyle({ width: '100%' })
  })

  // The loudness preview needs the measurement; until it lands the strip stays the
  // plain original rather than guessing a gain from nothing.
  it('shows no loudness preview before the measurement lands', async () => {
    ;(window as unknown as { api: unknown }).api = {
      waveform: vi.fn().mockResolvedValue(wave),
      loudness: vi.fn().mockResolvedValue(null),
    }
    renderWithQuery(
      <WaveformSolo
        inputPath="/m/a.wav"
        enabled
        clipDb={-1}
        normalize={{ mode: 'loudness', targetLufs: -14, truePeakDb: -1, peakDb: -1 }}
      />,
    )
    await screen.findByTestId('waveform-solo')
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByTestId('waveform-preview')).not.toBeInTheDocument()
  })
})
