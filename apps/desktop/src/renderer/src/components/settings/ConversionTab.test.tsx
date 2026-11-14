// @vitest-environment jsdom
import { BUNDLED_FLOWS } from '../../../../shared/cueFlows'
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_EDITOR_SECTIONS } from '../../../../shared/editorSections'
import i18n from '../../i18n'
import type { SyncedDraft } from '../../lib/settingsDraft'

// ConversionTab reads window.api.platform at module scope (isMacOS), so the bridge
// must exist before the module loads — hence the dynamic import below.
;(window as unknown as { api: unknown }).api = { platform: 'darwin' }
const { ConversionTab } = await import('./ConversionTab')

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
  traktorCueOffsetMs: '0',
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
  keepMp3Sources: false,
}

function renderTab(over: Partial<SyncedDraft> = {}) {
  const patch = vi.fn()
  render(<ConversionTab synced={{ ...synced, ...over }} patch={patch} />)
  return patch
}

describe('ConversionTab MP3 quality', () => {
  // A track can be converted to MP3 from the editor's format menu whatever the default
  // is, and that conversion uses this setting too: disabling it under AIFF hid a knob
  // that still decided how those MP3s sounded.
  it('keeps the quality control usable under any default format and says when it applies', () => {
    renderTab()
    expect(screen.getByTestId('settings-mp3-quality-320')).toBeEnabled()
    expect(screen.getByTestId('settings-mp3-quality-applies')).toHaveTextContent(
      i18n.t('settings.mp3QualityApplies'),
    )
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

  // Bit depth shapes the lossless encodes a track can be sent to from the editor even
  // when MP3 is the default, so it stays usable and names the formats it shapes.
  it('keeps the bit depth control usable under MP3 and stages the pick', () => {
    const patch = renderTab({ outputFormat: 'mp3' })
    expect(screen.getByTestId('settings-bit-depth-applies')).toHaveTextContent(
      i18n.t('settings.bitDepthApplies'),
    )
    fireEvent.click(screen.getByTestId('settings-bit-depth-16'))
    expect(patch).toHaveBeenCalledWith('outputBitDepth', '16')
  })

  // Every encoder resamples, so the rate pin applies to MP3 too.
  it('offers the sample rate pin for every format', () => {
    const patch = renderTab({ outputFormat: 'mp3' })
    fireEvent.click(screen.getByTestId('settings-sample-rate-44100'))
    expect(patch).toHaveBeenCalledWith('outputSampleRate', '44100')
  })

  // The corrected policy: only files Surco itself measured as upsampled get
  // written back at 44.1; everything genuine or unverified keeps its rate.
  it('offers the corrected sample-rate policy and stages it', () => {
    const patch = renderTab({ outputFormat: 'flac' })
    fireEvent.click(screen.getByTestId('settings-sample-rate-corrected'))
    expect(patch).toHaveBeenCalledWith('outputSampleRate', 'corrected')
  })

  it('keeps the FLAC compression control usable under any default format', () => {
    const patch = renderTab()
    expect(screen.getByTestId('settings-flac-compression-applies')).toHaveTextContent(
      i18n.t('settings.flacCompressionApplies'),
    )
    fireEvent.click(screen.getByTestId('settings-flac-compression-8'))
    expect(patch).toHaveBeenCalledWith('flacCompression', '8')
  })

  it('lists ALAC among the output formats', () => {
    renderTab({ outputFormat: 'alac' })
    expect(screen.getByTestId('settings-format-alac')).toBeInTheDocument()
  })

  describe('keep mp3 checkbox', () => {
    // The checkbox only acts while the export would transcode an mp3: with MP3 or "Same
    // as source" as the format the rule never fires, so it is disabled and says so.
    it('enables the checkbox for lossless formats', () => {
      renderTab({ outputFormat: 'aiff' })
      expect(screen.getByTestId('settings-keep-mp3')).toBeEnabled()
    })

    it('disables the checkbox under mp3 and source and says why', () => {
      renderTab({ outputFormat: 'mp3' })
      expect(screen.getByTestId('settings-keep-mp3')).toBeDisabled()
      expect(screen.getByText(i18n.t('settings.keepMp3SourcesOff'))).toBeInTheDocument()
      cleanup()
      renderTab({ outputFormat: 'source' })
      expect(screen.getByTestId('settings-keep-mp3')).toBeDisabled()
    })

    it('patches keepMp3Sources on toggle', () => {
      const patch = renderTab({ outputFormat: 'aiff' })
      fireEvent.click(screen.getByTestId('settings-keep-mp3'))
      expect(patch).toHaveBeenCalledWith('keepMp3Sources', true)
    })
  })

  // The format list is FORMAT_SETTINGS now (source + every OutputFormat); with a plain
  // OutputFormat[] list, picking 'source' would leave every segment unmarked.
  it('marks "Same as source" as the active segment when it is the pick', () => {
    renderTab({ outputFormat: 'source' })
    expect(screen.getByTestId('settings-format-source')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('settings-format-aiff')).toHaveAttribute('aria-pressed', 'false')
  })

  // With 'source' picked, any of the batch's files could be MP3, lossless PCM or FLAC —
  // so all three quality blocks must be usable at once instead of mutually exclusive.
  it('enables every quality block at once when the format is "same as source"', () => {
    renderTab({ outputFormat: 'source' })
    expect(screen.getByTestId('settings-mp3-quality-320')).toBeEnabled()
    expect(screen.getByTestId('settings-bit-depth-16')).toBeEnabled()
    expect(screen.getByTestId('settings-flac-compression-8')).toBeEnabled()
  })
})

describe('ConversionTab explanations', () => {
  // The Format tab read like a manual: every control carried its whole paragraph and what
  // format to pick competed with how Corrected treats padding. The chosen option says what
  // it does in one line, and the full text stays one (i) away, word for word.
  it.each([
    [
      'outputFormat',
      { outputFormat: 'aiff' },
      'settings.formatChoice.aiff',
      'settings.outputFormatHint',
    ],
    ['mp3Quality', { mp3Quality: 'v0' }, 'settings.mp3Choice.v0', 'settings.mp3QualityHint'],
    [
      'bitDepth',
      { outputBitDepth: 'corrected' },
      'settings.bitDepthChoice.corrected',
      'settings.bitDepthHint',
    ],
    [
      'sampleRate',
      { outputSampleRate: 'corrected' },
      'settings.sampleRateChoice.corrected',
      'settings.sampleRateHint',
    ],
  ] as const)(
    'shows the line of the chosen %s and keeps the rest behind (i)',
    (id, over, line, full) => {
      renderTab(over)
      const field = document.querySelector(`[data-search-id="${id}"]`) as HTMLElement
      expect(field).toHaveTextContent(i18n.t(line))
      const info = screen.getByTestId(`settings-info-${id}`)
      expect(info).toHaveTextContent(i18n.t(full))
      expect(field.textContent?.replace(info.textContent ?? '', '')).not.toContain(i18n.t(full))
    },
  )

  it('says that an MP3 source stays MP3 once, on the switch that decides it, not again under the format and in the quality (i)', async () => {
    await i18n.changeLanguage('es')
    renderTab({ outputFormat: 'mp3' })
    const text = document.body.textContent ?? ''
    await i18n.changeLanguage('en')
    expect(text).toContain(i18n.getFixedT('es')('settings.keepMp3SourcesOff'))
    expect(text).not.toMatch(/nunca se recodifica/)
  })

  // A line that only says the picked option again ("256 kbps CBR." under 256, "Writes
  // 24-bit." under 24-bit) is read for nothing, so those options carry no line at all and
  // only the ones that add something (320 is the DJ-pool standard, Corrected only touches
  // upsampled files) keep theirs.
  it.each([
    ['mp3Quality', { mp3Quality: '256' }, '256 kbps CBR.'],
    ['mp3Quality', { mp3Quality: '192' }, '192 kbps CBR.'],
    ['mp3Quality', { mp3Quality: '160' }, '160 kbps CBR.'],
    ['bitDepth', { outputBitDepth: '24' }, 'Writes 24-bit.'],
    ['sampleRate', { outputSampleRate: 'source' }, 'Never resamples.'],
    [
      'sampleRate',
      { outputSampleRate: '44100' },
      'Every file at 44.1 kHz, for gear that expects it.',
    ],
    [
      'sampleRate',
      { outputSampleRate: '48000' },
      'Every file at 48 kHz, for gear that expects it.',
    ],
  ] as const)('puts no line under a %s option that would only restate it', (id, over, line) => {
    renderTab(over)
    const field = document.querySelector(`[data-search-id="${id}"]`) as HTMLElement
    const info = screen.getByTestId(`settings-info-${id}`)
    const visible = field.textContent?.replace(info.textContent ?? '', '') ?? ''
    expect(visible).not.toContain(line)
    expect(visible).not.toMatch(/Choice/)
  })
})
