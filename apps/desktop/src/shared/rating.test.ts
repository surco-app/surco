import { describe, expect, it } from 'vitest'
import { formatRatingTag, ratingTagToStars, ratingToStars, starsToRating } from './rating'

describe('formatRatingTag', () => {
  // The FLAC Vorbis RATING value must match Traktor's POPM string byte-for-byte.
  it('builds the Traktor POPM string for the FLAC RATING comment', () => {
    expect(formatRatingTag(4)).toBe('traktor@native-instruments.de|204|0')
    expect(formatRatingTag(5)).toBe('traktor@native-instruments.de|255|0')
  })
})

describe('starsToRating', () => {
  it('maps 0–5 stars to Traktor steps of 51', () => {
    expect([0, 1, 2, 3, 4, 5].map(starsToRating)).toEqual([0, 51, 102, 153, 204, 255])
  })

  it('clamps out-of-range star counts', () => {
    expect(starsToRating(9)).toBe(255)
    expect(starsToRating(-1)).toBe(0)
  })
})

describe('ratingToStars', () => {
  it('maps a 0–255 byte back to the nearest star count', () => {
    expect(ratingToStars(255)).toBe(5)
    expect(ratingToStars(204)).toBe(4)
    expect(ratingToStars(51)).toBe(1)
    // Players that store WMP-style bytes (a 4★ at 196) still round to the right star.
    expect(ratingToStars(196)).toBe(4)
  })
})

describe('ratingTagToStars', () => {
  it('parses a numeric tag value into a star string', () => {
    expect(ratingTagToStars('204')).toBe('4')
  })

  // FLAC stores the whole "user|byte|count" string; pull the byte out of it.
  it('parses the Traktor POPM string', () => {
    expect(ratingTagToStars('traktor@native-instruments.de|153|0')).toBe('3')
  })

  // No rating must read as empty, so the writer preserves whatever is on disk
  // instead of clearing it on the next convert.
  it('treats missing or non-numeric values as no rating', () => {
    expect(ratingTagToStars('')).toBe('')
    expect(ratingTagToStars('  ')).toBe('')
    expect(ratingTagToStars('like')).toBe('')
    expect(ratingTagToStars('0')).toBe('')
  })
})
