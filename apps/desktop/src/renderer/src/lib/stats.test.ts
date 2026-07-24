import { describe, expect, it } from 'vitest'
import {
  MANUAL_SECONDS_PER_CONVERSION,
  formatTimeSaved,
  matchStatKey,
  nextMilestone,
  timeSavedSeconds,
} from './stats'

describe('timeSavedSeconds', () => {
  it('credits the per-conversion manual estimate for every conversion', () => {
    // The headline figure is the whole point of the Stats tab: it must scale
    // linearly with the count, not with the (irrelevant) length of the audio.
    expect(timeSavedSeconds(1)).toBe(MANUAL_SECONDS_PER_CONVERSION)
    expect(timeSavedSeconds(142)).toBe(142 * MANUAL_SECONDS_PER_CONVERSION)
  })

  it('never goes negative or fractional, since a count is a whole tally', () => {
    expect(timeSavedSeconds(0)).toBe(0)
    expect(timeSavedSeconds(-3)).toBe(0)
    expect(timeSavedSeconds(2.7)).toBe(2 * MANUAL_SECONDS_PER_CONVERSION)
  })
})

describe('formatTimeSaved', () => {
  it('humanizes the total as "h min" rather than a m:ss clock', () => {
    // 142 conversions at 4 min each is 568 min → 9 h 28 min, the believable
    // sentence we want to show, not "568:00".
    expect(formatTimeSaved(timeSavedSeconds(142))).toBe('9 h 28 min')
  })

  it('drops the minutes when the total lands on a whole hour', () => {
    expect(formatTimeSaved(3600)).toBe('1 h')
  })

  it('drops the hours below an hour so short tallies read cleanly', () => {
    expect(formatTimeSaved(40 * 60)).toBe('40 min')
  })
})

describe('nextMilestone', () => {
  // The milestone bar exists to give the counter a goal: it must always point at a
  // target strictly ahead, so hitting one immediately aims at the next.
  it('returns the first milestone strictly above the count', () => {
    expect(nextMilestone(0)).toBe(10)
    expect(nextMilestone(385)).toBe(500)
    expect(nextMilestone(500)).toBe(1000)
  })

  it('runs out quietly past the last milestone instead of inventing targets', () => {
    expect(nextMilestone(999999)).toBeNull()
  })
})

describe('matchStatKey', () => {
  // The provider decides which lifetime tally a match apply bumps; a wrong mapping
  // would silently credit Discogs with Bandcamp finds.
  it('maps each provider to its own counter', () => {
    expect(matchStatKey('discogs')).toBe('discogsMatches')
    expect(matchStatKey('bandcamp')).toBe('bandcampMatches')
  })

  it('routes a Deezer match to its own tally', () => {
    expect(matchStatKey('deezer')).toBe('deezerMatches')
  })
})
