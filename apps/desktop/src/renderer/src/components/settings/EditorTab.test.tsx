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

// The editor's sections are the user's to arrange: which start open, and in what
// order they stack below the metadata form. One list in Settings → Editor rules both.
describe('EditorTab sections', () => {
  it('lists every section in its configured order', () => {
    renderTab()
    const rows = screen.getAllByTestId(/^settings-section-row-/)
    expect(rows.map((r) => r.dataset.testid)).toEqual([
      'settings-section-row-form',
      'settings-section-row-properties',
      'settings-section-row-quality',
      'settings-section-row-output',
      'settings-section-row-normalize',
    ])
  })

  it('patches the open flag when a section is toggled', () => {
    const patch = renderTab()
    fireEvent.click(screen.getByTestId('settings-section-open-properties'))
    expect(patch).toHaveBeenCalledWith(
      'editorSections',
      DEFAULT_EDITOR_SECTIONS.map((s) =>
        s.id === 'properties' ? { ...s, open: true } : s,
      ),
    )
  })

  it('moves a section down one place', () => {
    const patch = renderTab()
    fireEvent.click(screen.getByTestId('settings-section-down-output'))
    expect(patch).toHaveBeenCalledWith(
      'editorSections',
      ['form', 'properties', 'quality', 'normalize', 'output'].map((id) =>
        DEFAULT_EDITOR_SECTIONS.find((s) => s.id === id),
      ),
    )
  })

  it('moves a section up one place', () => {
    const patch = renderTab()
    fireEvent.click(screen.getByTestId('settings-section-up-quality'))
    expect(patch).toHaveBeenCalledWith(
      'editorSections',
      ['form', 'quality', 'properties', 'output', 'normalize'].map((id) =>
        DEFAULT_EDITOR_SECTIONS.find((s) => s.id === id),
      ),
    )
  })

  // The metadata form is the editor's fixed header: it can't move, and the first
  // movable section can't climb above it — so their arrows must not exist/act.
  it('offers no arrows on the form row and no up arrow past it', () => {
    renderTab()
    expect(screen.queryByTestId('settings-section-up-form')).not.toBeInTheDocument()
    expect(screen.queryByTestId('settings-section-down-form')).not.toBeInTheDocument()
    expect(screen.getByTestId('settings-section-up-properties')).toBeDisabled()
  })

  it('disables the last row’s down arrow', () => {
    renderTab()
    expect(screen.getByTestId('settings-section-down-normalize')).toBeDisabled()
  })
})
