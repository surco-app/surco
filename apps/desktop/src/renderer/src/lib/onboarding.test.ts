import { describe, expect, it } from 'vitest'
import { DEFAULT_EDITOR_SECTIONS, type EditorSectionId } from '../../../shared/editorSections'
import type { Settings } from '../../../shared/types'
import {
  type AudioIntent,
  buildOnboardingPatch,
  deriveEditorSections,
  seedAudioIntents,
  shouldShowOnboarding,
} from './onboarding'
import {
  buildSettingsPatch,
  type LocalDraft,
  pickLocal,
  pickSynced,
  type SyncedDraft,
} from './settingsDraft'

// A full baseline so the drafts helper can seed exactly the way both surfaces do
// (pickSynced/pickLocal); each test overrides only the fields its assertion is about.
const settings: Settings = {
  theme: 'system',
  language: 'system',
  discogsToken: '',
  discogsFormats: [],
  discogsMaxResults: 10,
  searchProviders: ['discogs'],
  searchIgnoreWords: [],
  outputDir: '/out',
  outputFormat: 'aiff',
  addToAppleMusic: false,
  keepOutputCopy: true,
  overwriteOriginal: false,
  convertBesideOriginal: false,
  addToEngineDj: false,
  engineLibraryDir: '/music/Engine Library',
  engineDjPlaylist: 'Surco',
  filenameFormat: '{artist} - {title}',
  titleFormat: '',
  autoApplyFilename: false,
  groupingPresets: [],
  genrePresets: [],
  trimWhitespace: true,
  zeroPadTrack: true,
  visibleFields: [],
  requiredFields: [],
  coverMaxSize: 1200,
  coverSquare: false,
  coverUpscale: false,
  replaceLowResCover: false,
  flacFinderCovers: false,
  mp3Quality: '320',
  outputBitDepth: 'source',
  outputSampleRate: 'source',
  flacCompression: '5',
  showSpectrum: false,
  activityPanel: null,
  resultsWidth: null,
  autoAnalyze: false,
  showWaveform: true,
  showLoudness: true,
  autoMatch: false,
  continuousPlayback: false,
  keyNotation: 'camelot',
  normalize: { mode: 'none', targetLufs: -14, truePeakDb: -1, peakDb: -1 },
  declick: 'off',
  shortcutOverrides: {},
  editorSections: DEFAULT_EDITOR_SECTIONS,
  commandUsage: {},
  hasSeenOnboarding: false,
  conversionCount: 0,
  stats: {
    imported: 0,
    listened: 0,
    analyzed: 0,
    discogsMatches: 0,
    bandcampMatches: 0,
    deezerMatches: 0,
  },
  donateNudgeDismissed: false,
  donateNudgeLastShown: '',
  lastSeenChangelogVersion: '',
}

function drafts(
  over: {
    synced?: Partial<SyncedDraft>
    local?: Partial<LocalDraft>
    audioIntents?: AudioIntent[]
    seededIntents?: AudioIntent[]
    settings?: Pick<Settings, 'hasSeenOnboarding' | 'editorSections'>
  } = {},
): NonNullable<Parameters<typeof buildOnboardingPatch>[0]> {
  return {
    synced: { ...pickSynced(settings), ...over.synced },
    local: { ...pickLocal(settings), ...over.local },
    audioIntents: over.audioIntents ?? [],
    seededIntents: over.seededIntents ?? [],
    settings: over.settings ?? {
      hasSeenOnboarding: false,
      editorSections: DEFAULT_EDITOR_SECTIONS,
    },
  }
}

// Helpers to read the derived section list by concern rather than by index, so the
// tests survive a reorder of DEFAULT_EDITOR_SECTIONS.
function shown(sections: ReturnType<typeof deriveEditorSections>): EditorSectionId[] {
  return sections.filter((s) => !s.hidden).map((s) => s.id)
}
function isOpen(sections: ReturnType<typeof deriveEditorSections>, id: EditorSectionId): boolean {
  return sections.find((s) => s.id === id)?.open === true
}

describe('shouldShowOnboarding', () => {
  // The wizard is a first-run-only affordance: a returning user who already
  // configured (or deliberately skipped) it must never see it again.
  it('shows the wizard only before it has been seen', () => {
    expect(shouldShowOnboarding({ hasSeenOnboarding: false })).toBe(true)
    expect(shouldShowOnboarding({ hasSeenOnboarding: true })).toBe(false)
  })
})

describe('buildOnboardingPatch', () => {
  // Finishing must persist the staged choices AND mark the wizard seen in the
  // same write, so the picks take effect and the wizard never reappears.
  it('persists the chosen settings and marks onboarding seen', () => {
    const patch = buildOnboardingPatch(
      drafts({
        synced: { outputFormat: 'wav', searchProviders: ['discogs'] },
        local: { token: 'abc123', outputDir: '/out', autoMatch: true },
      }),
    )
    expect(patch).toEqual(
      expect.objectContaining({
        discogsToken: 'abc123',
        searchProviders: ['discogs'],
        outputFormat: 'wav',
        outputDir: '/out',
        showSpectrum: false,
        editorSections: deriveEditorSections([]),
        autoMatch: true,
        hasSeenOnboarding: true,
      }),
    )
  })

  // The convergence contract: the wizard's persistence IS the Settings save path plus
  // its own three fields. A serialization rule added to buildSettingsPatch (a trim, a
  // clamp, a gate) reaches the wizard without anyone remembering to copy it.
  it('serializes through buildSettingsPatch so the two save paths cannot drift', () => {
    const d = drafts({ local: { token: ' tok ', autoMatch: true } })
    expect(buildOnboardingPatch(d)).toEqual({
      ...buildSettingsPatch(d.synced, d.local),
      showSpectrum: false,
      editorSections: deriveEditorSections([]),
      hasSeenOnboarding: true,
    })
  })

  // A stray space around a pasted token breaks Discogs auth, so it is cleaned like
  // the settings form does.
  it('trims the token', () => {
    const patch = buildOnboardingPatch(drafts({ local: { token: '  tok  ' } }))
    expect(patch.discogsToken).toBe('tok')
  })

  // Skipping (null drafts) must still mark the wizard seen, but must NOT write
  // empty values over the defaults the user never touched.
  it('marks onboarding seen without overwriting defaults when skipped', () => {
    expect(buildOnboardingPatch(null)).toEqual({ hasSeenOnboarding: true })
  })

  // Auto-match needs the user's own Discogs token (its own rate-limit bucket). Ticking it in the
  // wizard without entering a token must never persist as on, or a folder drop would hammer the
  // shared key and earn 429s.
  it('refuses to enable auto-match when no token was entered', () => {
    const patch = buildOnboardingPatch(
      drafts({
        synced: { searchProviders: ['discogs'] },
        local: { token: '   ', autoMatch: true },
      }),
    )
    expect(patch.autoMatch).toBe(false)
  })

  // Bandcamp needs no token, so a Bandcamp-only setup can persist auto-match on.
  it('enables auto-match for a Bandcamp-only setup without a token', () => {
    const patch = buildOnboardingPatch(
      drafts({ synced: { searchProviders: ['bandcamp'] }, local: { token: '', autoMatch: true } }),
    )
    expect(patch.autoMatch).toBe(true)
    expect(patch.searchProviders).toEqual(['bandcamp'])
  })

  // The destination chosen in the wizard's format step must reach settings, so a new
  // macOS user who picks "Apple Music only" doesn't silently keep the folder copy too.
  it('persists the chosen output destination', () => {
    const patch = buildOnboardingPatch(
      drafts({ synced: { addToAppleMusic: true, keepOutputCopy: false } }),
    )
    expect(patch.addToAppleMusic).toBe(true)
    expect(patch.keepOutputCopy).toBe(false)
  })

  // Engine DJ chosen in the wizard must reach settings like any other destination, or a
  // Denon user's first conversions would silently skip their Engine library.
  it('persists Engine DJ as the destination', () => {
    const patch = buildOnboardingPatch(
      drafts({ synced: { addToEngineDj: true, keepOutputCopy: true } }),
    )
    expect(patch.addToEngineDj).toBe(true)
    expect(patch.keepOutputCopy).toBe(true)
  })
})

describe('deriveEditorSections', () => {
  // The whole point of the reworked wizard: a DJ who only wants correct metadata
  // shouldn't be shown the audio-surgery sections they'll never touch. With no audio
  // intent picked, the editor keeps only the always-present sections and hides the rest.
  it('hides every audio section when no audio intent is picked', () => {
    const sections = deriveEditorSections([])
    expect(shown(sections)).toEqual(['form', 'properties', 'quality', 'output'])
    // trim/declick/normalize are the ones the metadata-only DJ never uses.
    for (const id of ['trim', 'declick', 'normalize'] as const) {
      expect(sections.find((s) => s.id === id)?.hidden).toBe(true)
    }
  })

  // "Restaurar vinilo" is the noise-repair lane: the two sections that clean a vinyl
  // rip (silence trim + click repair) become visible, while volume normalize stays hidden.
  it('reveals trim and declick for the restore-vinyl intent', () => {
    const sections = deriveEditorSections(['restore'])
    expect(shown(sections)).toContain('trim')
    expect(shown(sections)).toContain('declick')
    expect(sections.find((s) => s.id === 'normalize')?.hidden).toBe(true)
  })

  // "Ajustar volumen" reveals only the normalize section, leaving the vinyl-repair
  // sections hidden for a DJ who rips from clean digital sources.
  it('reveals only normalize for the level-volume intent', () => {
    const sections = deriveEditorSections(['level'])
    expect(shown(sections)).toContain('normalize')
    expect(sections.find((s) => s.id === 'trim')?.hidden).toBe(true)
    expect(sections.find((s) => s.id === 'declick')?.hidden).toBe(true)
  })

  // Intents compose: a DJ who both restores vinyl and levels volume gets all three
  // audio sections, not just the last one picked.
  it('composes multiple audio intents', () => {
    const sections = deriveEditorSections(['restore', 'level'])
    for (const id of ['trim', 'declick', 'normalize'] as const) {
      expect(shown(sections)).toContain(id)
    }
  })

  // The metadata form, quality verdict and output name are the product's core — they
  // are never hidden regardless of which audio intents are (or aren't) picked.
  it('always keeps the metadata, quality and output sections', () => {
    for (const intents of [[], ['restore'], ['level'], ['quality']] as const) {
      const sections = deriveEditorSections([...intents])
      for (const id of ['form', 'quality', 'output'] as const) {
        expect(sections.find((s) => s.id === id)?.hidden).not.toBe(true)
      }
    }
  })

  // The quality intent's payload is the spectrogram (showSpectrum), not the fold state:
  // the quality section keeps its shipped default so the wizard can't drift from
  // Settings → Editor. It's shown either way; only the spectrogram analysis is gated.
  it('leaves the quality section at its default fold regardless of the quality intent', () => {
    const withoutIntent = isOpen(deriveEditorSections([]), 'quality')
    expect(isOpen(deriveEditorSections(['quality']), 'quality')).toBe(withoutIntent)
  })
})

describe('buildOnboardingPatch with audio intents', () => {
  // The quality intent is the single control that turns on the spectrogram analysis;
  // without it a metadata-only DJ isn't paying for the FFT pass.
  it('enables the spectrum only for the quality intent', () => {
    expect(buildOnboardingPatch(drafts({ audioIntents: [] })).showSpectrum).toBe(false)
    expect(buildOnboardingPatch(drafts({ audioIntents: ['quality'] })).showSpectrum).toBe(true)
  })

  // The finished patch carries the derived section layout so the very first editor a
  // new DJ opens already matches the workflow they described.
  it('persists the derived editor sections', () => {
    const patch = buildOnboardingPatch(drafts({ audioIntents: ['restore'] }))
    expect(patch.editorSections).toEqual(deriveEditorSections(['restore']))
  })

  // Skipping must still leave the section layout untouched (the defaults), so a skip
  // never silently hides sections the user didn't ask to hide.
  it('does not touch editor sections when skipped', () => {
    expect(buildOnboardingPatch(null).editorSections).toBeUndefined()
  })
})

describe('seedAudioIntents', () => {
  // First run keeps the shipped behavior: intents start unpicked (except the
  // spectrum-backed one) so a brand-new editor stays minimal until the DJ opts in.
  it('seeds only the spectrum-backed intent on a first run', () => {
    expect(seedAudioIntents(settings)).toEqual([])
    expect(seedAudioIntents({ ...settings, showSpectrum: true })).toEqual(['quality'])
  })

  // A re-run must open with the checkboxes reflecting what the DJ already has,
  // so finishing without touching anything can be a no-op.
  it('seeds intents from the visible sections on a re-run', () => {
    const rerun = { ...settings, hasSeenOnboarding: true }
    expect(seedAudioIntents(rerun)).toEqual(['restore', 'level'])
    expect(seedAudioIntents({ ...rerun, showSpectrum: true })).toEqual([
      'restore',
      'level',
      'quality',
    ])
  })

  // restore owns two sections; a hand-arranged half state (only declick visible)
  // seeds it unpicked, so leaving it untouched preserves the mixed state.
  it('does not seed restore from a mixed hand-arranged state', () => {
    const sections = DEFAULT_EDITOR_SECTIONS.map((s) =>
      s.id === 'trim' ? { ...s, hidden: true } : s,
    )
    expect(
      seedAudioIntents({ ...settings, hasSeenOnboarding: true, editorSections: sections }),
    ).toEqual(['level'])
  })

  it('does not seed level when normalize is hidden', () => {
    const sections = DEFAULT_EDITOR_SECTIONS.map((s) =>
      s.id === 'normalize' ? { ...s, hidden: true } : s,
    )
    expect(
      seedAudioIntents({ ...settings, hasSeenOnboarding: true, editorSections: sections }),
    ).toEqual(['restore'])
  })
})

describe('buildOnboardingPatch on a re-run', () => {
  // A layout the DJ arranged by hand: reordered, refolded, otherTags and the
  // vinyl-repair pair hidden. The re-run must treat it as sacred.
  const customized = [
    { id: 'form', open: true },
    { id: 'otherTags', open: true, hidden: true },
    { id: 'quality', open: false },
    { id: 'properties', open: true },
    { id: 'normalize', open: true },
    { id: 'trim', open: false, hidden: true },
    { id: 'declick', open: false, hidden: true },
    { id: 'output', open: false },
  ] satisfies Settings['editorSections']
  const rerun = { hasSeenOnboarding: true, editorSections: customized }

  // The core promise of the menu entry: reopen, press Finish, nothing changes.
  it('leaves the section layout untouched when no intent was toggled', () => {
    const patch = buildOnboardingPatch(
      drafts({ audioIntents: ['level'], seededIntents: ['level'], settings: rerun }),
    )
    expect(patch.editorSections).toEqual(customized)
  })

  // Toggling one intent on reveals exactly its sections — order, folds and the
  // sections no intent governs (otherTags) survive byte for byte.
  it('reveals only the toggled-on intent sections, preserving everything else', () => {
    const patch = buildOnboardingPatch(
      drafts({ audioIntents: ['level', 'restore'], seededIntents: ['level'], settings: rerun }),
    )
    expect(patch.editorSections).toEqual([
      { id: 'form', open: true },
      { id: 'otherTags', open: true, hidden: true },
      { id: 'quality', open: false },
      { id: 'properties', open: true },
      { id: 'normalize', open: true },
      { id: 'trim', open: false },
      { id: 'declick', open: false },
      { id: 'output', open: false },
    ])
  })

  // Toggling one intent off hides its sections and nothing else: trim/declick keep
  // the hidden they already had, untouched by the unchanged restore intent.
  it('hides only the toggled-off intent sections', () => {
    const patch = buildOnboardingPatch(
      drafts({ audioIntents: [], seededIntents: ['level'], settings: rerun }),
    )
    expect(patch.editorSections).toEqual([
      { id: 'form', open: true },
      { id: 'otherTags', open: true, hidden: true },
      { id: 'quality', open: false },
      { id: 'properties', open: true },
      { id: 'normalize', open: true, hidden: true },
      { id: 'trim', open: false, hidden: true },
      { id: 'declick', open: false, hidden: true },
      { id: 'output', open: false },
    ])
  })

  // First run still rebuilds from the defaults (hiding otherTags): the shipped
  // new-user behavior must not change because re-runs exist.
  it('keeps deriving from defaults on a first run', () => {
    const patch = buildOnboardingPatch(drafts({ audioIntents: ['restore'] }))
    expect(patch.editorSections).toEqual(deriveEditorSections(['restore']))
  })

  // A store that predates declick (upgraded install): seedAudioIntents reads the
  // absent section as visible, so restore seeds picked; toggling restore off must
  // hide both sections it governs, not just the one physically in the stored list.
  it('hides declick too when the stored list predates it and restore is toggled off', () => {
    const stale = DEFAULT_EDITOR_SECTIONS.filter((s) => s.id !== 'declick')
    const patch = buildOnboardingPatch(
      drafts({
        audioIntents: ['level'],
        seededIntents: ['restore', 'level'],
        settings: { hasSeenOnboarding: true, editorSections: stale },
      }),
    )
    const ids = (patch.editorSections ?? []).map((s) => s.id)
    const trim = patch.editorSections?.find((s) => s.id === 'trim')
    const declick = patch.editorSections?.find((s) => s.id === 'declick')
    expect(trim?.hidden).toBe(true)
    expect(declick?.hidden).toBe(true)
    expect(ids.indexOf('declick')).toBe(ids.indexOf('trim') + 1)
  })
})
