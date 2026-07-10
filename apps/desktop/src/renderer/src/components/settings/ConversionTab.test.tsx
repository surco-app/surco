// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SyncedDraft } from '../../lib/settingsDraft'
import '../../i18n'

// ConversionTab reads window.api.platform at module scope (isMacOS), so the bridge
// must exist before the module loads — hence the dynamic import below.
;(window as unknown as { api: unknown }).api = { platform: 'darwin' }
const { ConversionTab } = await import('./ConversionTab')

afterEach(cleanup)

const synced: SyncedDraft = {
  theme: 'system',
  language: 'system',
  outputFormat: 'aiff',
  addToAppleMusic: false,
  keepOutputCopy: true,
  overwriteOriginal: false,
  convertBesideOriginal: false,
  addToEngineDj: false,
  engineDjPlaylist: 'Surco',
  filenameFormat: '{artist} - {title}',
  titleFormat: '',
  autoApplyFilename: false,
  grouping: '',
  genre: '',
  trimWhitespace: true,
  zeroPadTrack: true,
  visibleFields: [],
  requiredFields: [],
  coverMaxSize: '1200',
  coverSquare: false,
  coverUpscale: false,
  replaceLowResCover: false,
  flacFinderCovers: false,
  mp3Quality: '320',
  outputBitDepth: 'source',
  outputSampleRate: 'source',
  flacCompression: '5',
  showSpectrum: true,
  showLoudness: true,
  autoAnalyze: false,
  keyNotation: 'camelot',
  normalize: { mode: 'none', targetLufs: -14, truePeakDb: -1, peakDb: -1 },
  shortcutOverrides: {},
  discogsFormats: [],
  discogsMaxResults: 10,
  searchProviders: ['discogs'],
  searchIgnoreWords: '',
}

function renderTab(over: Partial<SyncedDraft> = {}) {
  const patch = vi.fn()
  render(<ConversionTab synced={{ ...synced, ...over }} patch={patch} />)
  return patch
}

describe('ConversionTab MP3 quality', () => {
  // The encoder choice only means something while MP3 is the pick; surfacing it under
  // AIFF would read as a knob that does nothing.
  it('offers the quality control only while MP3 is the output format', () => {
    renderTab()
    expect(screen.queryByTestId('settings-mp3-quality-320')).toBeNull()
    cleanup()
    renderTab({ outputFormat: 'mp3' })
    expect(screen.getByTestId('settings-mp3-quality-320')).toBeInTheDocument()
  })

  it('stages the V0 pick through the draft patch', () => {
    const patch = renderTab({ outputFormat: 'mp3' })
    fireEvent.click(screen.getByTestId('settings-mp3-quality-v0'))
    expect(patch).toHaveBeenCalledWith('mp3Quality', 'v0')
  })

  // "It's an app that does it all": the expanded ladder lets a space-constrained USB
  // export land on 192/128 instead of silently forcing 320.
  it('offers the full CBR ladder and both VBR presets', () => {
    const patch = renderTab({ outputFormat: 'mp3' })
    fireEvent.click(screen.getByTestId('settings-mp3-quality-192'))
    expect(patch).toHaveBeenCalledWith('mp3Quality', '192')
    fireEvent.click(screen.getByTestId('settings-mp3-quality-v2'))
    expect(patch).toHaveBeenCalledWith('mp3Quality', 'v2')
  })

  // Bit depth shapes PCM/FLAC/ALAC encodes; under MP3 it would read as a knob that
  // does nothing (LAME has no bit depth).
  it('shows the bit depth control only for lossless formats and stages the pick', () => {
    renderTab({ outputFormat: 'mp3' })
    expect(screen.queryByTestId('settings-bit-depth-16')).toBeNull()
    cleanup()
    const patch = renderTab({ outputFormat: 'flac' })
    fireEvent.click(screen.getByTestId('settings-bit-depth-16'))
    expect(patch).toHaveBeenCalledWith('outputBitDepth', '16')
  })

  // Every encoder resamples, so the rate pin applies to MP3 too.
  it('offers the sample rate pin for every format', () => {
    const patch = renderTab({ outputFormat: 'mp3' })
    fireEvent.click(screen.getByTestId('settings-sample-rate-44100'))
    expect(patch).toHaveBeenCalledWith('outputSampleRate', '44100')
  })

  it('shows the FLAC compression control only while FLAC is the format', () => {
    renderTab()
    expect(screen.queryByTestId('settings-flac-compression-8')).toBeNull()
    cleanup()
    const patch = renderTab({ outputFormat: 'flac' })
    fireEvent.click(screen.getByTestId('settings-flac-compression-8'))
    expect(patch).toHaveBeenCalledWith('flacCompression', '8')
  })

  it('lists ALAC among the output formats', () => {
    renderTab({ outputFormat: 'alac' })
    expect(screen.getByTestId('settings-format-alac')).toBeInTheDocument()
  })
})
