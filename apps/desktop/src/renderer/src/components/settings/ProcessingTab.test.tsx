// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_EDITOR_SECTIONS } from '../../../../shared/editorSections'
import type { SyncedDraft } from '../../lib/settingsDraft'
import '../../i18n'
import { ProcessingTab } from './ProcessingTab'

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
  asciiFileNames: false,
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

function renderTab(over: Partial<SyncedDraft> = {}): ReturnType<typeof vi.fn> {
  const patch = vi.fn()
  render(<ProcessingTab synced={{ ...synced, ...over }} patch={patch} />)
  return patch
}

// The audio-processing steps split out of the Format tab: click repair and loudness
// normalization, both staged through the same draft patch the modal saves.
describe('ProcessingTab', () => {
  it('stages the click-repair mode', () => {
    const patch = renderTab()
    fireEvent.click(screen.getByTestId('declick-mode-standard'))
    expect(patch).toHaveBeenCalledWith('declick', 'standard')
  })

  it('stages a loudness normalization mode', () => {
    const patch = renderTab()
    fireEvent.click(screen.getByTestId('normalize-mode-loudness'))
    expect(patch).toHaveBeenCalledWith('normalize', expect.objectContaining({ mode: 'loudness' }))
  })

  // Traktor cues ride the re-encode into MP3, AIFF, FLAC and WAV; only ALAC has nowhere to
  // keep them, and "Same as source" never resolves to ALAC. A warning on every format
  // teaches the DJ to ignore it, the same rule the editor's sections follow.
  it('warns about dropped cues only when the default format drops them', () => {
    const loudness = { mode: 'loudness' as const, targetLufs: -14, truePeakDb: -1, peakDb: -1 }
    renderTab({ normalize: loudness, outputFormat: 'alac' })
    expect(screen.getByTestId('normalize-cue-warning')).toBeInTheDocument()
    for (const outputFormat of ['source', 'aiff', 'mp3', 'wav', 'flac'] as const) {
      cleanup()
      renderTab({ normalize: loudness, outputFormat })
      expect(screen.queryByTestId('normalize-cue-warning')).not.toBeInTheDocument()
    }
  })
})
