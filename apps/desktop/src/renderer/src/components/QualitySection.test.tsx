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

function track(): TrackItem {
  return {
    id: 'a',
    inputPath: '/music/a.flac',
    fileName: 'a.flac',
    listLabel: 'a.flac',
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

function renderSection(spectrum: SpectrumResult): void {
  ;(window as unknown as { api: unknown }).api = {
    spectrogram: vi.fn().mockResolvedValue(spectrum),
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
}

beforeEach(() => {
  vi.restoreAllMocks()
})

// The caption under the spectrogram is the only place that explains the verdict, so
// it must say WHY this file earned its colour — a generic one-liner reads the same
// under a green badge and a red one, leaving "Bad quality" unjustified.
describe('QualitySection verdict caption', () => {
  it('explains a bad verdict as a lossy transcode signature', async () => {
    renderSection({ image: '', cutoffHz: 16000, sampleRateHz: 44100, processed: false })
    expect(
      await screen.findByText(i18n.t('editor.qualityCaptionBad', { cutoff: '16.0 kHz' })),
    ).toBeInTheDocument()
  })

  it('explains a warn verdict as the high-bitrate-lossy ambiguity zone', async () => {
    renderSection({ image: '', cutoffHz: 18000, sampleRateHz: 44100, processed: false })
    expect(
      await screen.findByText(i18n.t('editor.qualityCaptionWarn', { cutoff: '18.0 kHz' })),
    ).toBeInTheDocument()
  })

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
})
