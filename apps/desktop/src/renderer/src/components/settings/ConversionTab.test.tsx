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

const local: LocalDraft = { token: '', outputDir: '/out', autoMatch: false }

function renderTab(over: Partial<SyncedDraft> = {}) {
  const patch = vi.fn()
  render(
    <ConversionTab synced={{ ...synced, ...over }} local={local} patch={patch} onChangeDir={vi.fn()} />,
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
