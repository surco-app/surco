import { describe, expect, it } from 'vitest'
import { DEFAULT_IMPORT_FIELDS } from '../../../shared/defaults'
import type { CustomField, Settings } from '../../../shared/types'
import { DEFAULT_SEARCH_PROVIDERS, NO_HIDDEN_SOURCES, viewPrefsOf } from './viewPrefs'

const stored = (over: Partial<Settings>): Settings => over as Settings

describe('viewPrefsOf', () => {
  // The first paint can come before settings load: the views a new install shows (spectrum,
  // waveform, list waves and positions, rail names, sidebar, suggestions) must already be
  // on, and the opt-in behaviours off, so nothing flips once the real settings land.
  it('reads the persisted defaults while settings have not loaded', () => {
    const prefs = viewPrefsOf(null)
    expect(prefs).toEqual({
      showSpectrum: true,
      showWaveform: true,
      hasToken: false,
      searchProviders: DEFAULT_SEARCH_PROVIDERS,
      importFields: DEFAULT_IMPORT_FIELDS,
      genrePresets: [],
      fullReleaseDate: false,
      replaceLowResCover: false,
      hiddenSources: NO_HIDDEN_SOURCES,
      showSidebar: true,
      showRailNames: true,
      showListPositions: true,
      continuousPlayback: false,
      filenameFormat: '{artist} - {title}',
      customFields: [],
      sessionsMade: [],
      matchingDismissed: [],
      suggestionsOpen: true,
      showListWaves: true,
    })
  })

  // The memoized Editor and the playlist browser key off these fallbacks: a new array on
  // every render before settings load would re-render them for nothing.
  it('falls back to the same provider and hidden-source constants on every render', () => {
    expect(viewPrefsOf(null).searchProviders).toBe(DEFAULT_SEARCH_PROVIDERS)
    expect(viewPrefsOf(null).hiddenSources).toBe(NO_HIDDEN_SOURCES)
  })

  // The fallbacks App spells as `?? []` are a fresh array each render today; turning them
  // into a shared constant would change what the hooks fed with them see.
  it('keeps the empty-list fallbacks fresh on every call', () => {
    expect(viewPrefsOf(null).customFields).not.toBe(viewPrefsOf(null).customFields)
    expect(viewPrefsOf(null).sessionsMade).not.toBe(viewPrefsOf(null).sessionsMade)
    expect(viewPrefsOf(null).genrePresets).not.toBe(viewPrefsOf(null).genrePresets)
    expect(viewPrefsOf(null).matchingDismissed).not.toBe(viewPrefsOf(null).matchingDismissed)
  })

  // What the user turned off or chose wins over every default, and the stored lists reach
  // the hooks as the same arrays the settings hold.
  it('reads what the user chose and passes the stored lists through', () => {
    const customFields: CustomField[] = [{ key: 'mood', label: 'Mood' }]
    const hiddenSources: Settings['hiddenSources'] = ['traktor']
    const sessionsMade = ['p1']
    const matchingDismissed = ['a|b']
    const genrePresets = ['House']
    const prefs = viewPrefsOf(
      stored({
        showSpectrum: false,
        showWaveform: false,
        discogsToken: 'tok',
        searchProviders: ['bandcamp', 'beatport'],
        importFields: ['title', 'nope'],
        genrePresets,
        fullReleaseDate: true,
        replaceLowResCover: true,
        hiddenSources,
        showSidebar: false,
        showRailNames: false,
        showListPositions: false,
        continuousPlayback: true,
        filenameFormat: '{title}',
        customFields,
        sessionsMade,
        matchingDismissed,
        matchingSuggestionsOpen: false,
        showListWaves: false,
      }),
    )
    expect(prefs).toEqual({
      showSpectrum: false,
      showWaveform: false,
      hasToken: true,
      searchProviders: ['bandcamp'],
      importFields: ['title'],
      genrePresets,
      fullReleaseDate: true,
      replaceLowResCover: true,
      hiddenSources,
      showSidebar: false,
      showRailNames: false,
      showListPositions: false,
      continuousPlayback: true,
      filenameFormat: '{title}',
      customFields,
      sessionsMade,
      matchingDismissed,
      suggestionsOpen: false,
      showListWaves: false,
    })
    expect(prefs.customFields).toBe(customFields)
    expect(prefs.hiddenSources).toBe(hiddenSources)
    expect(prefs.sessionsMade).toBe(sessionsMade)
    expect(prefs.matchingDismissed).toBe(matchingDismissed)
    expect(prefs.genrePresets).toBe(genrePresets)
  })

  // An empty token is no token: the sweep must not treat a cleared field as a key.
  it('reads an empty Discogs token as none', () => {
    expect(viewPrefsOf(stored({ discogsToken: '', searchProviders: [] })).hasToken).toBe(false)
  })
})
