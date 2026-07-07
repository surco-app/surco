// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LocalDraft, SyncedDraft } from '../../lib/settingsDraft'
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
  addToEngineDj: false,
  engineDjPlaylist: 'Surco',
  filenameFormat: '{artist} - {title}',
  autoApplyFilename: false,
  grouping: '',
  genre: '',
  trimWhitespace: true,
  zeroPadTrack: true,
  visibleFields: [],
  requiredFields: [],
  coverMaxSize: '1200',
  coverSquare: false,
  replaceLowResCover: false,
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
}

const local: LocalDraft = {
  token: '',
  outputDir: '/out',
  engineLibraryDir: '/music/Engine Library',
  autoMatch: false,
}

function renderTab(over: Partial<SyncedDraft> = {}) {
  const patch = vi.fn()
  render(
    <ConversionTab
      synced={{ ...synced, ...over }}
      local={local}
      patch={patch}
      onChangeDir={vi.fn()}
      onChangeEngineDir={vi.fn()}
    />,
  )
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

  // ALAC exists as a target precisely because Music ingests it — unlike FLAC it must
  // not pin the destination to the output folder.
  it('lists ALAC without the FLAC destination restriction', () => {
    renderTab({ outputFormat: 'flac' })
    expect(screen.getByText(/Apple Music can't play FLAC/)).toBeInTheDocument()
    cleanup()
    renderTab({ outputFormat: 'alac' })
    expect(screen.getByTestId('settings-format-alac')).toBeInTheDocument()
    expect(screen.queryByText(/Apple Music can't play FLAC/)).not.toBeInTheDocument()
  })
})

describe('ConversionTab Engine DJ destination', () => {
  // Choosing Engine DJ must clear the other destinations in the same patch batch —
  // a leftover addToAppleMusic or overwriteOriginal would make the radio show one
  // thing and the conversion do another.
  it('stages Engine DJ as an exclusive destination choice', () => {
    const patch = renderTab()
    fireEvent.click(screen.getByTestId('settings-destination-engineDj'))
    expect(patch).toHaveBeenCalledWith('addToEngineDj', true)
    expect(patch).toHaveBeenCalledWith('addToAppleMusic', false)
    expect(patch).toHaveBeenCalledWith('keepOutputCopy', true)
    expect(patch).toHaveBeenCalledWith('overwriteOriginal', false)
  })

  // The library folder only matters once conversions are actually registered there;
  // showing it under every destination would read as an unrelated global path.
  it('shows the Engine library folder only while Engine DJ is the destination', () => {
    renderTab()
    expect(screen.queryByTestId('settings-engine-library')).toBeNull()
    cleanup()
    renderTab({ addToEngineDj: true })
    expect(screen.getByTestId('settings-engine-library')).toHaveValue('/music/Engine Library')
  })

  // Engine DJ plays FLAC natively, so the FLAC restriction that pins Apple Music to
  // the folder must not grey this option out.
  it('keeps Engine DJ selectable while FLAC is the format', () => {
    renderTab({ outputFormat: 'flac' })
    expect(screen.getByTestId('settings-destination-engineDj')).toBeEnabled()
    expect(screen.getByTestId('settings-destination-appleMusic')).toBeDisabled()
  })

  // The playlist is where the DJ finds what Surco converted, so it belongs with the
  // destination — editable, seeded from the setting, staged through the draft patch.
  it('shows the editable playlist field only while Engine DJ is the destination', () => {
    renderTab()
    expect(screen.queryByTestId('settings-engine-playlist')).toBeNull()
    cleanup()
    const patch = renderTab({ addToEngineDj: true })
    const field = screen.getByTestId('settings-engine-playlist')
    expect(field).toHaveValue('Surco')
    fireEvent.change(field, { target: { value: 'Pool' } })
    expect(patch).toHaveBeenCalledWith('engineDjPlaylist', 'Pool')
  })
})
