// @vitest-environment jsdom
import { BUNDLED_FLOWS } from '../../../../shared/cueFlows'
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_EDITOR_SECTIONS } from '../../../../shared/editorSections'
import i18n from '../../i18n'
import type { SyncedDraft } from '../../lib/settingsDraft'
import { ProcessingTab } from './ProcessingTab'
import { SettingsHintsVisible } from './SettingsPrimitives'

afterEach(cleanup)

const synced: SyncedDraft = {
  theme: 'system',
  density: 'normal',
  cueFlows: BUNDLED_FLOWS,
  activeCueFlow: 'mine',
  cueJumpBars: 16,
  cueQuantize: 'bar',
  cueGridTolerance: 10,
  cueLettersByTime: true,
  cueFlowToRekordbox: true,
  cueFlowToTraktor: true,
  cueFlowToEngine: true,
  cueFlowToSerato: true,
  cueFlowToVirtualdj: true,
  cueLearnFromEdits: true,
  hiddenSources: [],
  language: 'system',
  outputFormat: 'aiff',
  keepMp3Sources: false,
  clearListAfterConvert: false,
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
  addToSerato: false,
  syncSerato: false,
  addToVirtualdj: false,
  syncVirtualdj: false,
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
  editorSections: DEFAULT_EDITOR_SECTIONS,
  discogsFormats: [],
  discogsMaxResults: 10,
  searchProviders: ['discogs'],
  searchIgnoreWords: '',
  searchByAlbumFirst: false,
  autoCleanSpacing: false,
  autoCleanCase: false,
}

function renderTab(over: Partial<SyncedDraft> = {}): ReturnType<typeof vi.fn> {
  const patch = vi.fn()
  const draft = { ...synced, ...over }
  render(
    <SettingsHintsVisible value={draft.showEditorHints}>
      <ProcessingTab synced={draft} patch={patch} />
    </SettingsHintsVisible>,
  )
  return patch
}

// The audio-processing steps split out of the Format tab: click repair and loudness
// normalization, both staged through the same draft patch the modal saves.
describe('ProcessingTab', () => {
  it('stages the click-repair mode', () => {
    const patch = renderTab()
    fireEvent.click(screen.getByTestId('declick-mode-standard'))
    expect(patch).toHaveBeenCalledWith('declick', { mode: 'standard', noise: 'off' })
  })

  it('stages a background-noise step as the default for every conversion', () => {
    const patch = renderTab()
    fireEvent.click(screen.getByTestId('declick-noise-medium'))
    expect(patch).toHaveBeenCalledWith('declick', { mode: 'off', noise: 'medium' })
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

  // The inline-explanations switch is read from the draft, so turning it off in the
  // Editor tab hides these section explanations at once, before saving, like the
  // normalize mode line below them already did.
  it('hides the section explanations while the draft has the explanations off', () => {
    renderTab({ showEditorHints: false })
    expect(screen.queryByTestId('declick-hint')).not.toBeInTheDocument()
    expect(screen.queryByTestId('normalize-hint')).not.toBeInTheDocument()
    expect(screen.queryByTestId('declick-mode-hint')).not.toBeInTheDocument()
    expect(screen.queryByTestId('declick-noise-hint')).not.toBeInTheDocument()
  })

  it('shows the section explanations while the draft has the explanations on', () => {
    renderTab({ showEditorHints: true })
    expect(screen.getByTestId('declick-hint')).toHaveTextContent(i18n.t('declick.hint'))
    expect(screen.getByTestId('normalize-hint')).toHaveTextContent(i18n.t('normalize.hint'))
    expect(screen.getByTestId('declick-mode-hint')).toBeInTheDocument()
    expect(screen.getByTestId('declick-noise-hint')).toBeInTheDocument()
  })
})
