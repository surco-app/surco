import { describe, expect, it } from 'vitest'
import { autoMatchAvailable } from './autoMatch'

describe('autoMatchAvailable', () => {
  // No source to search → nothing to auto-match against.
  it('is false with no search source', () => {
    expect(autoMatchAvailable({ searchProviders: [], discogsToken: 'tok' })).toBe(false)
  })

  // Discogs runs on a shared, rate-limited key, so a personal token is required whenever
  // it's one of the sources — a whole-import sweep would otherwise exhaust the budget.
  it('needs a Discogs token when Discogs is a source', () => {
    expect(autoMatchAvailable({ searchProviders: ['discogs'], discogsToken: '' })).toBe(false)
    expect(autoMatchAvailable({ searchProviders: ['discogs'], discogsToken: 'tok' })).toBe(true)
    expect(autoMatchAvailable({ searchProviders: ['discogs', 'bandcamp'], discogsToken: '' })).toBe(
      false,
    )
  })

  // Bandcamp has its own pacing and no token, so Bandcamp-only auto-match needs none.
  it('needs no token when only non-Discogs sources are enabled', () => {
    expect(autoMatchAvailable({ searchProviders: ['bandcamp'], discogsToken: '' })).toBe(true)
  })
})
