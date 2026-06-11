import { describe, expect, it } from 'vitest'
import type { TrackItem } from '../types'
import { needsDiscogsPrefetch } from './prefetch'

function track(over: Partial<TrackItem> = {}): TrackItem {
  return {
    id: 'a',
    inputPath: '/music/a.wav',
    fileName: 'a.wav',
    listLabel: 'a.wav',
    query: '',
    status: 'idle',
    meta: {
      title: '',
      artist: '',
      album: '',
      albumArtist: '',
      year: '',
      genre: '',
      grouping: '',
      comment: '',
      trackNumber: '',
      discNumber: '',
      bpm: '',
      key: '',
      publisher: '',
      catalogNumber: '',
      remixArtist: '',
    },
    ...over,
  }
}

describe('needsDiscogsPrefetch', () => {
  // Warming the Discogs search/release on hover hits the network, so it is gated
  // on a personal token — the shared app key's 60 req/min is too scarce to spend
  // speculatively across a whole crate.
  it('is true with a personal token and something to search for', () => {
    expect(needsDiscogsPrefetch(track({ query: 'aphex windowlicker' }), true)).toBe(true)
  })

  it('is false without a personal token, sparing the shared rate limit', () => {
    expect(needsDiscogsPrefetch(track({ query: 'aphex windowlicker' }), false)).toBe(false)
  })

  it('is false when the track has no query to search', () => {
    expect(needsDiscogsPrefetch(track({ query: '   ' }), true)).toBe(false)
  })
})
