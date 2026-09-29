import { describe, expect, it } from 'vitest'
import {
  formatMatchCount,
  formatTimeSaved,
  MANUAL_SECONDS_PER_CONVERSION,
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

// The match legend holds five sources on one line; a four-digit tally would push it onto a
// second one, so counts from a thousand up shrink to a short "K" form.
describe('formatMatchCount', () => {
  it('keeps counts under a thousand whole', () => {
    expect(formatMatchCount(999, 'en')).toBe('999')
  })

  it('shortens thousands to one decimal in K', () => {
    expect(formatMatchCount(1234, 'en')).toBe('1.2K')
  })

  // Intl's own compact form is no use here: Spanish writes "1,2 mil" (longer than the
  // number) and German does not shorten thousands at all. Only the decimal mark follows
  // the language.
  it('uses the language decimal mark with the same K in every language', () => {
    expect(formatMatchCount(1234, 'es')).toBe('1,2K')
    expect(formatMatchCount(1234, 'de')).toBe('1,2K')
  })

  it('drops the decimal from ten thousand up', () => {
    expect(formatMatchCount(12345, 'en')).toBe('12K')
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

  it('routes a Beatport match to its own tally', () => {
    expect(matchStatKey('beatport')).toBe('beatportMatches')
  })

  it('routes a Deezer match to its own tally', () => {
    expect(matchStatKey('deezer')).toBe('deezerMatches')
  })

  it('routes a MusicBrainz match to its own tally instead of crediting Discogs', () => {
    expect(matchStatKey('musicbrainz')).toBe('musicbrainzMatches')
  })
})
