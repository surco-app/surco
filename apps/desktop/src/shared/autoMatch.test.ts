import { describe, expect, it } from 'vitest'
import { autoMatchAvailable, usableProviders } from './autoMatch'

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

  it('an unconnected Beatport does not count as a source, since it cannot search', () => {
    expect(autoMatchAvailable({ searchProviders: ['beatport'], discogsToken: '' })).toBe(false)
    expect(
      autoMatchAvailable({
        searchProviders: ['beatport'],
        discogsToken: '',
        beatportUsername: 'dj',
      }),
    ).toBe(true)
    expect(
      autoMatchAvailable({ searchProviders: ['bandcamp', 'beatport'], discogsToken: '' }),
    ).toBe(true)
  })

  // Bandcamp has its own pacing and no token, so Bandcamp-only auto-match needs none.
  it('needs no token when only non-Discogs sources are enabled', () => {
    expect(autoMatchAvailable({ searchProviders: ['bandcamp'], discogsToken: '' })).toBe(true)
  })
})

describe('usableProviders', () => {
  it('leaves an unconnected Beatport out of the sweep, so a big import does not fill the feed with the same error', () => {
    expect(usableProviders({ searchProviders: ['deezer', 'beatport'] })).toEqual(['deezer'])
    expect(
      usableProviders({ searchProviders: ['deezer', 'beatport'], beatportUsername: 'dj' }),
    ).toEqual(['deezer', 'beatport'])
  })
})
