// @vitest-environment jsdom
import { BUNDLED_FLOWS } from '../../../../shared/cueFlows'
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_EDITOR_SECTIONS } from '../../../../shared/editorSections'
import type { SyncedDraft } from '../../lib/settingsDraft'
import '../../i18n'
import { EditorTab } from './EditorTab'

afterEach(cleanup)

const synced: SyncedDraft = {
  theme: 'system',
  cueFlows: BUNDLED_FLOWS,
  activeCueFlow: 'mine',
  cueJumpBars: 16,
  cueQuantize: 'bar',
  cueLettersByTime: true,
  cueFlowToRekordbox: true,
  cueFlowToTraktor: true,
  cueFlowToEngine: true,
  cueLearnFromEdits: true,
  hiddenSources: [],
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
  addToRekordbox: false,
  addToTraktor: false,
  syncTraktor: false,
  syncRekordbox: false,
  completeCuesOnClose: false,
  syncEngineDj: false,
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
  declick: { mode: 'off', noise: 'off' },
  shortcutOverrides: {},
  discogsFormats: [],
  discogsMaxResults: 10,
  searchProviders: ['discogs'],
  searchIgnoreWords: '',
  searchByAlbumFirst: false,
  autoCleanSpacing: false,
  autoCleanCase: false,
  editorSections: DEFAULT_EDITOR_SECTIONS,
}

function renderTab(over: Partial<SyncedDraft> = {}): ReturnType<typeof vi.fn> {
  const patch = vi.fn()
  render(<EditorTab synced={{ ...synced, ...over }} patch={patch} />)
  return patch
}

// The Editor tab holds the editor's behaviour preferences; the section layout lives in
// its own Sections tab now (see LayoutTab.test).
describe('EditorTab preferences', () => {
  it('stages the grouping and genre quick-button lists', () => {
    const patch = renderTab()
    fireEvent.change(screen.getByTestId('settings-grouping'), { target: { value: 'Bases' } })
    expect(patch).toHaveBeenCalledWith('grouping', 'Bases')
    fireEvent.change(screen.getByTestId('settings-genre'), { target: { value: 'Techno' } })
    expect(patch).toHaveBeenCalledWith('genre', 'Techno')
  })

  it('stages the spectrum and loudness toggles', () => {
    const patch = renderTab()
    fireEvent.click(screen.getByTestId('settings-show-spectrum'))
    expect(patch).toHaveBeenCalledWith('showSpectrum', false)
    fireEvent.click(screen.getByTestId('settings-show-loudness'))
    expect(patch).toHaveBeenCalledWith('showLoudness', false)
  })

  // Analyze-everything only means something while the spectrum analysis is on, so it's
  // disabled (still visible) when the spectrum is off.
  it('disables analyze-on-import while the spectrum is off', () => {
    renderTab({ showSpectrum: false })
    expect(screen.getByTestId('settings-auto-analyze')).toBeDisabled()
  })

  it('nests analyze-on-import under the quality analysis it depends on', () => {
    renderTab()
    const nested = screen.getByTestId('settings-auto-analyze-nested')
    expect(nested).toContainElement(screen.getByTestId('settings-auto-analyze'))
    expect(screen.getByTestId('settings-quality-analysis')).toContainElement(nested)
    expect(screen.getByTestId('settings-quality-analysis')).toContainElement(
      screen.getByTestId('settings-show-spectrum'),
    )
    expect(nested).not.toContainElement(screen.getByTestId('settings-show-spectrum'))
  })

  it('stages the key notation choice', () => {
    const patch = renderTab()
    fireEvent.click(screen.getByTestId('settings-key-notation-musical'))
    expect(patch).toHaveBeenCalledWith('keyNotation', 'musical')
  })

  // The section layout manager moved to the Sections tab — it must not render here.
  it('no longer renders the section rows', () => {
    renderTab()
    expect(screen.queryByTestId('settings-section-row-form')).not.toBeInTheDocument()
  })
})

describe('EditorTab inline explanations toggle', () => {
  it('stages the inline explanations preference', () => {
    const patch = renderTab()
    fireEvent.click(screen.getByTestId('settings-show-editor-hints'))
    expect(patch).toHaveBeenCalledWith('showEditorHints', false)
  })
})
