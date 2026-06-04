import { describe, expect, it } from 'vitest'
import { MANUAL_SECONDS_PER_CONVERSION, formatTimeSaved, timeSavedSeconds } from './stats'

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
