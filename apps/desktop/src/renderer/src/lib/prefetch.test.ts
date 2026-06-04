import { describe, expect, it } from 'vitest'
import type { TrackItem } from '../types'
import { needsSpectrum } from './prefetch'

function track(over: Partial<TrackItem> = {}): TrackItem {
  return {
    id: 'a',
    inputPath: '/music/a.wav',
    fileName: 'a.wav',
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
