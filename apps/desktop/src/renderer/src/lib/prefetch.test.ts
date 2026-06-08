import { describe, expect, it } from 'vitest'
import type { TrackItem } from '../types'
import { needsDiscogsPrefetch, needsSpectrum } from './prefetch'

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

describe('needsSpectrum', () => {
  // Hovering a row should warm the spectrum the editor would otherwise compute on
  // open — but only when the feature is on and the work has not already been done.
  it('is true for a track with no spectrum when the feature is enabled', () => {
    expect(needsSpectrum(track(), true)).toBe(true)
  })

  it('is false once the spectrum is already cached on the track', () => {
    expect(
      needsSpectrum(
        track({ spectrum: { image: 'data:', cutoffHz: 20000, sampleRateHz: 44100 } }),
        true,
      ),
    ).toBe(false)
  })

  it('is false when the spectrum feature is disabled, so we never spawn ffmpeg for it', () => {
    expect(needsSpectrum(track(), false)).toBe(false)
  })
})

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
