// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WaveformResult } from '../../../shared/types'
import '../i18n'
import { WaveformCompare } from './WaveformCompare'

const wave: WaveformResult = { peaks: [0.1, 0.9, 0.4, 1], durationSec: 60 }

function renderWithQuery(ui: React.ReactElement): ReturnType<typeof render> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

beforeEach(() => {
  // jsdom has no 2D canvas context (it logs a not-implemented error and returns
  // null); the draw helper already handles null, so stub it to keep the noise out.
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null)
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
