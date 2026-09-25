// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_EDITOR_SECTIONS } from '../../../../shared/editorSections'
import type { SyncedDraft } from '../../lib/settingsDraft'
import '../../i18n'
import { NamingTab } from './NamingTab'

afterEach(cleanup)

const synced: SyncedDraft = {
  theme: 'system',
  language: 'system',
  outputFormat: 'aiff',
  keepMp3Sources: false,
  addToAppleMusic: false,
  keepOutputCopy: true,
  overwriteOriginal: false,
  convertBesideOriginal: false,
  backupPolicy: 'always',
  backupRetentionDays: 30,
  backupMaxGb: 10,
  addToEngineDj: false,
  syncTraktor: false,
  syncRekordbox: false,
  engineDjPlaylist: 'Surco',
  traktorCueOffsetMs: '0',
  filenameFormat: '{artist} - {title}',
  titleFormat: '',
  autoApplyFilename: false,
  grouping: '',
  genre: '',
  genreSeparator: ', ',
  groupingSeparator: ', ',
  trimWhitespace: true,
  zeroPadTrack: true,
  fullReleaseDate: false,
  visibleFields: [],
  customFields: [],
  importFields: [],
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
  showEditorHints: true,
  autoAnalyze: false,
  keyNotation: 'camelot',
  normalize: { mode: 'none', targetLufs: -14, truePeakDb: -1, peakDb: -1 },
  declick: 'off',
  shortcutOverrides: {},
  editorSections: DEFAULT_EDITOR_SECTIONS,
  discogsFormats: [],
  discogsMaxResults: 10,
  searchProviders: ['discogs'],
  searchIgnoreWords: '',
}

function renderTab(over: Partial<SyncedDraft> = {}) {
  const patch = vi.fn()
  render(<NamingTab synced={{ ...synced, ...over }} patch={patch} />)
  return patch
}

// A custom field has no sample value, so the preview shows its name where its token sits:
// the user sees the pattern uses it instead of a gap that reads like a typo.
describe('NamingTab custom field token', () => {
  it('previews a custom field token with the field name', () => {
    renderTab({
      filenameFormat: '{artist} [{vinylCondition}]',
      customFields: [{ key: 'vinylCondition', label: 'Estado del vinilo' }],
    })
    expect(screen.getByTestId('settings-format-preview')).toHaveTextContent('[Estado del vinilo]')
  })
})

describe('NamingTab filename preview extension', () => {
  // ALAC lives in an .m4a container; the raw format name was shown instead of the
  // real on-disk extension.
  it('shows the ALAC container extension, not the format name', () => {
    renderTab({ outputFormat: 'alac' })
    expect(screen.getByTestId('settings-format-preview')).toHaveTextContent(/\.m4a$/)
  })

  // 'source' has no extension of its own; the preview falls back to what a
  // per-file resolution would default to (AIFF, the app's own default).
  it('shows the AIFF fallback extension for "same as source"', () => {
    renderTab({ outputFormat: 'source' })
    expect(screen.getByTestId('settings-format-preview')).toHaveTextContent(/\.aiff$/)
  })
})

describe('NamingTab full release date', () => {
  it('stages the full release date toggle', () => {
    const patch = renderTab()
    fireEvent.click(screen.getByTestId('settings-full-release-date'))
    expect(patch).toHaveBeenCalledWith('fullReleaseDate', true)
  })
})
