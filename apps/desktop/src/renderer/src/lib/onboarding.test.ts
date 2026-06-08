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
      outputFormat: 'wav',
      grouping: 'Bases, Cantaditas',
      genre: 'Hard Dance, Techno',
      showSpectrum: false,
      autoMatch: true,
      requiredFields: ['title', 'artist', 'genre'],
    })
    expect(patch).toEqual({
      discogsToken: 'abc123',
      outputFormat: 'wav',
      groupingPresets: ['Bases', 'Cantaditas'],
      genrePresets: ['Hard Dance', 'Techno'],
      showSpectrum: false,
      autoMatch: true,
      requiredFields: ['title', 'artist', 'genre'],
      hasSeenOnboarding: true,
    })
  })

  // A stray space around a pasted token breaks Discogs auth, and empty grouping
  // segments would render as blank quick-buttons, so both are cleaned like the
  // settings form does.
  it('trims the token and drops blank grouping segments', () => {
    const patch = buildOnboardingPatch({
      discogsToken: '  tok  ',
      outputFormat: 'aiff',
      grouping: 'Bases, , Cantaditas,',
      genre: 'Hard Dance, , Techno,',
      showSpectrum: true,
      autoMatch: false,
      requiredFields: ['title', 'artist'],
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
})
