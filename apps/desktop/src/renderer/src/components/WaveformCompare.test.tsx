// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
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
  // normalization actually applied. Each strip carries its own file's numbers.
  it('shows each file’s measured loudness under its strip', async () => {
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
})
