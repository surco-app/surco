// @vitest-environment jsdom
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
  declick: 'off',
  shortcutOverrides: {},
  discogsFormats: [],
  discogsMaxResults: 10,
  searchProviders: ['discogs'],
  searchIgnoreWords: '',
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
