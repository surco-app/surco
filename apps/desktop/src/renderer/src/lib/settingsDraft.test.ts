import { describe, expect, it } from 'vitest'
import type { Settings } from '../../../shared/types'
import { buildSettingsPatch, type LocalDraft, pickSynced } from './settingsDraft'

const settings: Settings = {
  theme: 'system',
  language: 'system',
  discogsToken: '',
  discogsFormats: [],
  discogsMaxResults: 10,
  searchProviders: ['discogs'],
  outputDir: '/out',
  outputFormat: 'aiff',
  addToAppleMusic: false,
  keepOutputCopy: true,
  overwriteOriginal: false,
  filenameFormat: '{artist} - {title}',
  autoApplyFilename: false,
  groupingPresets: ['House'],
  genrePresets: ['Techno'],
  trimWhitespace: true,
  zeroPadTrack: true,
  visibleFields: [],
  requiredFields: [],
  coverMaxSize: 1200,
  coverSquare: false,
  replaceLowResCover: false,
  showSpectrum: true,
  showWaveform: true,
  showLoudness: true,
  autoMatch: false,
  continuousPlayback: false,
  keyNotation: 'camelot',
  normalize: { mode: 'none', targetLufs: -14, truePeakDb: -1, peakDb: -1 },
  shortcutOverrides: {},
  hasSeenOnboarding: true,
  conversionCount: 0,
  donateNudgeDismissed: false,
  donateNudgeLastShown: '',
}

const local: LocalDraft = { token: 'tok', outputDir: '/out', autoMatch: false }

describe('pickSynced', () => {
  // The presets persist as arrays but edit as one comma-joined text field, so seeding has
  // to flatten them — and round-trip back through buildSettingsPatch unchanged.
  it('joins the preset arrays into comma text for editing', () => {
    const draft = pickSynced({ ...settings, groupingPresets: ['A', 'B'], genrePresets: ['C'] })
    expect(draft.grouping).toBe('A, B')
    expect(draft.genre).toBe('C')
    expect(draft.coverMaxSize).toBe('1200')
  })
})

describe('buildSettingsPatch', () => {
  // Presets edit as free comma text; on save they must split back into clean arrays with
  // stray whitespace and empty entries (a trailing comma, a double comma) dropped.
  it('parses comma text back into trimmed, non-empty preset arrays', () => {
    const draft = pickSynced({ ...settings })
    const patch = buildSettingsPatch({ ...draft, grouping: ' House , , Techno ,' }, local)
    expect(patch.groupingPresets).toEqual(['House', 'Techno'])
  })

  // A blank format would make every output collide on one name, so the default is restored.
  it('restores the default filename format when the field is left blank', () => {
    const draft = pickSynced({ ...settings })
    expect(buildSettingsPatch({ ...draft, filenameFormat: '   ' }, local).filenameFormat).toBe(
      '{artist} - {title}',
    )
  })

  // The cover cap is a free text field; a non-numeric or negative value can't be a size, so
  // it falls back to the default rather than persisting garbage.
  it('clamps an unparseable cover size to the default', () => {
    const draft = pickSynced({ ...settings })
    expect(buildSettingsPatch({ ...draft, coverMaxSize: 'abc' }, local).coverMaxSize).toBe(1200)
    expect(buildSettingsPatch({ ...draft, coverMaxSize: '-5' }, local).coverMaxSize).toBe(1200)
    expect(buildSettingsPatch({ ...draft, coverMaxSize: '800' }, local).coverMaxSize).toBe(800)
  })

  // Auto-match hits Discogs with the user's token; without one it cannot run, so saving must
  // never leave it enabled even if the toggle was on.
  it('forces auto-match off when there is no token, even if the toggle is on', () => {
    const draft = pickSynced({ ...settings })
    expect(buildSettingsPatch(draft, { ...local, token: '  ', autoMatch: true }).autoMatch).toBe(
      false,
    )
    expect(buildSettingsPatch(draft, { ...local, token: 'tok', autoMatch: true }).autoMatch).toBe(
      true,
    )
  })

  // The token is stored trimmed so stray paste whitespace can't break the auth header.
  it('trims the token', () => {
    const draft = pickSynced({ ...settings })
    expect(buildSettingsPatch(draft, { ...local, token: '  tok  ' }).discogsToken).toBe('tok')
  })

  // The auto-apply toggle decides whether the naming pattern fills the output name on its
  // own, so it has to survive the draft round-trip unchanged to actually take effect on save.
  it('round-trips the auto-apply filename toggle', () => {
    const draft = pickSynced({ ...settings, autoApplyFilename: true })
    expect(draft.autoApplyFilename).toBe(true)
    expect(buildSettingsPatch(draft, local).autoApplyFilename).toBe(true)
  })
})
