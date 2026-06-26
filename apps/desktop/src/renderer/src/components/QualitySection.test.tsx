// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SpectrumResult } from '../../../shared/types'
import i18n from '../i18n'
import type { TrackItem } from '../types'
import { QualitySection } from './QualitySection'

afterEach(cleanup)

function track(inputPath = '/music/a.flac'): TrackItem {
  const fileName = inputPath.split('/').pop() ?? inputPath
  return {
    id: 'a',
    inputPath,
    fileName,
    listLabel: fileName,
    query: '',
    status: 'idle',
    meta: {
      title: '',
      artist: '',
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
    },
  }
}

function renderSection(spectrum: SpectrumResult, inputPath?: string): void {
  ;(window as unknown as { api: unknown }).api = {
    spectrogram: vi.fn().mockResolvedValue(spectrum),
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <QualitySection
        item={track(inputPath)}
        showSpectrum
        showLoudness={false}
        open
        onToggle={vi.fn()}
        onShowLoudnessHelp={vi.fn()}
      />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.restoreAllMocks()
})

// Folding the section away must stop its (heavy) decode, not just hide the result — the
// whole point of the collapse is "not now". So a closed section never calls ffmpeg.
describe('QualitySection analysis gating', () => {
  it('does not analyze while the section is collapsed', async () => {
    const spectrogram = vi
      .fn()
      .mockResolvedValue({ image: '', cutoffHz: 21000, sampleRateHz: 44100, processed: false })
    ;(window as unknown as { api: unknown }).api = { spectrogram }
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <QualitySection
          item={track()}
          showSpectrum
          showLoudness={false}
          open={false}
          onToggle={vi.fn()}
          onShowLoudnessHelp={vi.fn()}
        />
      </QueryClientProvider>,
    )
    await new Promise((r) => setTimeout(r, 0))
    expect(spectrogram).not.toHaveBeenCalled()
  })
})

// The caption under the spectrogram is the only place that explains the verdict, so
// it must say WHY this file earned its colour — a generic one-liner reads the same
// under a green badge and a red one, leaving "Bad quality" unjustified.
describe('QualitySection verdict caption', () => {
  it('explains a bad verdict as a lossy signature for a lossy container', async () => {
    // An mp3 with a low ceiling is just a low-bitrate file — bad, but expected for the
    // format, so it gets the plain bad caption rather than the fake-lossless one.
    renderSection({ image: '', cutoffHz: 16000, sampleRateHz: 44100, processed: false }, '/m/a.mp3')
    expect(
      await screen.findByText(i18n.t('editor.qualityCaptionBad', { cutoff: '16.0 kHz' })),
    ).toBeInTheDocument()
  })

  it('explains a warn verdict as the high-bitrate-lossy ambiguity zone', async () => {
    renderSection({ image: '', cutoffHz: 18000, sampleRateHz: 44100, processed: false }, '/m/a.mp3')
    expect(
      await screen.findByText(i18n.t('editor.qualityCaptionWarn', { cutoff: '18.0 kHz' })),
    ).toBeInTheDocument()
  })

  // Surco measures where the spectrum stops, not the source bitrate — the two only
  // correlate. A YouTube 128 upscaled to 320 leaves sparse highs that push the measured
  // line up, so a confident "~192 kbps" guess reads as wrong to anyone who knows the file.
  // The captions for the inconclusive verdicts (good = reaches the line, warn = short of it)
  // must describe the observation, never name a bitrate — a guess an expert spots instantly.
  // The bad/transcode captions are exempt: a detected knee IS a lossy signature, so naming
  // it is a measurement, not a guess.
  it.each(['editor.qualityCaptionGood', 'editor.qualityCaptionWarn'])(
    'does not pin a specific source bitrate in %s',
    (key) => {
      expect(i18n.t(key, { cutoff: '19.0 kHz' })).not.toMatch(/kbps/)
    },
  )

  it('explains a good verdict as a full lossless spectrum', async () => {
    renderSection({ image: '', cutoffHz: 21000, sampleRateHz: 44100, processed: false })
    expect(
      await screen.findByText(i18n.t('editor.qualityCaptionGood', { cutoff: '21.0 kHz' })),
    ).toBeInTheDocument()
  })

  it('flags regenerated highs with a Reprocessed badge, not Bad quality over cutoff boilerplate', async () => {
    // The enhancer hump reaches past the good line, so a "full spectrum" view under
    // a "Bad quality" badge reads as a contradiction. The processed case gets its
    // own badge naming the manipulation, paired with its enhancer caption.
    renderSection({ image: '', cutoffHz: 16000, sampleRateHz: 44100, processed: true })
    expect(
      await screen.findByText(i18n.t('editor.qualityCaptionProcessed', { cutoff: '16.0 kHz' })),
    ).toBeInTheDocument()
    expect(screen.getByTestId('quality-badge')).toHaveTextContent(i18n.t('editor.qualityProcessed'))
  })

  it('passes a knee-free dark master as good, with the genuine-master caption not the warn one', async () => {
    // A real false positive: a genuine master tapers smoothly to ~18 kHz with no
    // codec knee. It must read as Good quality, and the caption must explain it is a
    // gently rolled-off but genuine master — not the "~192 kbps source" warn text.
    renderSection({
      image: '',
      cutoffHz: 18000,
      sampleRateHz: 44100,
      processed: false,
      hasKnee: false,
    })
    expect(
      await screen.findByText(i18n.t('editor.qualityCaptionGenuine', { cutoff: '18.0 kHz' })),
    ).toBeInTheDocument()
    expect(screen.getByTestId('quality-badge')).toHaveTextContent(i18n.t('editor.qualityGood'))
  })

  it('shows the upsample note when a high-rate file walls off at 22.05 kHz', async () => {
    // Orthogonal to the codec verdict: a 48 kHz file whose real bandwidth ends at
    // 22.05 kHz is upsampled from 44.1 kHz. The note must appear so a green badge
    // does not read as a clean bill of hi-res.
    renderSection({
      image: '',
      cutoffHz: 20000,
      sampleRateHz: 48000,
      processed: false,
      hasKnee: false,
      upsampled: true,
    })
    expect(await screen.findByTestId('quality-upsampled')).toHaveTextContent(
      i18n.t('editor.qualityUpsampled'),
    )
  })

  // The headline case for a DJ: a .flac that is really a re-encoded lossy file. A codec
  // knee can't occur in genuine lossless, so the badge names the fraud ("Fake lossless")
  // rather than the generic "Bad quality", and the caption says the container is lying.
  it('flags a lossless file with a codec knee as a fake-lossless transcode', async () => {
    renderSection(
      { image: '', cutoffHz: 16000, sampleRateHz: 44100, processed: false, hasKnee: true },
      '/music/a.flac',
    )
    expect(await screen.findByTestId('quality-badge')).toHaveTextContent(
      i18n.t('editor.qualityTranscode'),
    )
    expect(
      screen.getByText(i18n.t('editor.qualityCaptionTranscode', { cutoff: '16.0 kHz' })),
    ).toBeInTheDocument()
  })

  // The same knee in a lossy container is just a low-bitrate file, not a fraud: no transcode
  // badge — that distinction is the whole point of gating on the container.
  it('does not flag the same knee in a lossy container as a transcode', async () => {
    renderSection(
      { image: '', cutoffHz: 16000, sampleRateHz: 44100, processed: false, hasKnee: true },
      '/music/a.mp3',
    )
    expect(await screen.findByTestId('quality-badge')).toHaveTextContent(
      i18n.t('editor.qualityBad'),
    )
  })

  it('shows no upsample note for a genuine high-rate file', async () => {
    renderSection({
      image: '',
      cutoffHz: 20000,
      sampleRateHz: 48000,
      processed: false,
      hasKnee: false,
      upsampled: false,
    })
    await screen.findByTestId('quality-badge')
    expect(screen.queryByTestId('quality-upsampled')).not.toBeInTheDocument()
  })
})

describe('QualitySection analysis failure', () => {
  afterEach(cleanup)

  it('shows a compact error state, not the raw ffmpeg command, when the analysis fails', async () => {
    // ffmpeg dumps its full command and temp paths on failure — useless to a user
    // and already logged in main. The section must show a friendly icon + message,
    // never that wall of text.
    const raw = 'Command failed: /Applications/Surco.app/.../ffmpeg ... Cannot determine format'
    ;(window as unknown as { api: unknown }).api = {
      spectrogram: vi.fn().mockRejectedValue(new Error(raw)),
    }
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <QualitySection
          item={track()}
          showSpectrum
          showLoudness={false}
          open
          onToggle={vi.fn()}
          onShowLoudnessHelp={vi.fn()}
        />
      </QueryClientProvider>,
    )
    const error = await screen.findByTestId('quality-error')
    expect(error).toHaveTextContent(i18n.t('editor.analyzeError'))
    expect(screen.queryByText(raw)).not.toBeInTheDocument()
  })
})
