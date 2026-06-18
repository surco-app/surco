import { describe, expect, it } from 'vitest'
import { buildOnboardingPatch, shouldShowOnboarding } from './onboarding'

describe('shouldShowOnboarding', () => {
  // The wizard is a first-run-only affordance: a returning user who already
  // configured (or deliberately skipped) it must never see it again.
  it('shows the wizard only before it has been seen', () => {
    expect(shouldShowOnboarding({ hasSeenOnboarding: false })).toBe(true)
    expect(shouldShowOnboarding({ hasSeenOnboarding: true })).toBe(false)
  })
})

describe('buildOnboardingPatch', () => {
  // Finishing must persist the three choices AND mark the wizard seen in the
  // same write, so the picks take effect and the wizard never reappears.
  it('persists the chosen settings and marks onboarding seen', () => {
    const patch = buildOnboardingPatch({
      discogsToken: 'abc123',
      searchProviders: ['discogs'],
      outputFormat: 'wav',
      grouping: 'Bases, Cantaditas',
      genre: 'Hard Dance, Techno',
      showSpectrum: false,
      autoMatch: true,
      visibleFields: ['title', 'artist', 'album', 'genre'],
      requiredFields: ['title', 'artist', 'genre'],
      addToAppleMusic: true,
      overwriteOriginal: false,
      keepOutputCopy: false,
    })
    expect(patch).toEqual({
      discogsToken: 'abc123',
      searchProviders: ['discogs'],
      outputFormat: 'wav',
      groupingPresets: ['Bases', 'Cantaditas'],
      genrePresets: ['Hard Dance', 'Techno'],
      showSpectrum: false,
      autoMatch: true,
      visibleFields: ['title', 'artist', 'album', 'genre'],
      requiredFields: ['title', 'artist', 'genre'],
      addToAppleMusic: true,
      overwriteOriginal: false,
      keepOutputCopy: false,
      hasSeenOnboarding: true,
    })
  })

  // A stray space around a pasted token breaks Discogs auth, and empty grouping
  // segments would render as blank quick-buttons, so both are cleaned like the
  // settings form does.
  it('trims the token and drops blank grouping segments', () => {
    const patch = buildOnboardingPatch({
      discogsToken: '  tok  ',
      searchProviders: ['discogs'],
      outputFormat: 'aiff',
      grouping: 'Bases, , Cantaditas,',
      genre: 'Hard Dance, , Techno,',
      showSpectrum: true,
      autoMatch: false,
      visibleFields: ['title', 'artist'],
      requiredFields: ['title', 'artist'],
      addToAppleMusic: true,
      overwriteOriginal: false,
      keepOutputCopy: true,
    })
    expect(patch.discogsToken).toBe('tok')
    expect(patch.groupingPresets).toEqual(['Bases', 'Cantaditas'])
    expect(patch.genrePresets).toEqual(['Hard Dance', 'Techno'])
  })

  // Skipping (null choices) must still mark the wizard seen, but must NOT write
  // empty values over the defaults the user never touched.
  it('marks onboarding seen without overwriting defaults when skipped', () => {
    expect(buildOnboardingPatch(null)).toEqual({ hasSeenOnboarding: true })
  })

  // Auto-match needs the user's own Discogs token (its own rate-limit bucket). Ticking it in the
  // wizard without entering a token must never persist as on, or a folder drop would hammer the
  // shared key and earn 429s.
  it('refuses to enable auto-match when no token was entered', () => {
    const patch = buildOnboardingPatch({
      discogsToken: '   ',
      searchProviders: ['discogs'],
      outputFormat: 'aiff',
      grouping: '',
      genre: '',
      showSpectrum: true,
      autoMatch: true,
      visibleFields: ['title', 'artist'],
      requiredFields: ['title', 'artist'],
      addToAppleMusic: false,
      overwriteOriginal: false,
      keepOutputCopy: true,
    })
    expect(patch.autoMatch).toBe(false)
  })

  // Bandcamp needs no token, so a Bandcamp-only setup can persist auto-match on.
  it('enables auto-match for a Bandcamp-only setup without a token', () => {
    const patch = buildOnboardingPatch({
      discogsToken: '',
      searchProviders: ['bandcamp'],
      outputFormat: 'aiff',
      grouping: '',
      genre: '',
      showSpectrum: true,
      autoMatch: true,
      visibleFields: [],
      requiredFields: [],
      addToAppleMusic: false,
      overwriteOriginal: false,
      keepOutputCopy: true,
    })
    expect(patch.autoMatch).toBe(true)
    expect(patch.searchProviders).toEqual(['bandcamp'])
  })

  // The destination chosen in the wizard's format step must reach settings, so a new
  // macOS user who picks "Apple Music only" doesn't silently keep the folder copy too.
  it('persists the chosen output destination', () => {
    const patch = buildOnboardingPatch({
      discogsToken: '',
      searchProviders: ['discogs'],
      outputFormat: 'aiff',
      grouping: '',
      genre: '',
      showSpectrum: true,
      autoMatch: false,
      visibleFields: [],
      requiredFields: [],
      addToAppleMusic: true,
      overwriteOriginal: false,
      keepOutputCopy: false,
    })
    expect(patch.addToAppleMusic).toBe(true)
    expect(patch.keepOutputCopy).toBe(false)
  })

  // The fields chosen in the wizard's Fields step must reach settings in the picked
  // order, so a new user's editor matches what they set up rather than the defaults.
  it('persists the chosen visible fields in order', () => {
    const patch = buildOnboardingPatch({
      discogsToken: '',
      searchProviders: ['discogs'],
      outputFormat: 'aiff',
      grouping: '',
      genre: '',
      showSpectrum: true,
      autoMatch: false,
      visibleFields: ['artist', 'title', 'bpm'],
      requiredFields: ['artist'],
      addToAppleMusic: false,
      overwriteOriginal: false,
      keepOutputCopy: true,
    })
    expect(patch.visibleFields).toEqual(['artist', 'title', 'bpm'])
    expect(patch.requiredFields).toEqual(['artist'])
  })
})
