import { describe, expect, it } from 'vitest'
import { formatTime, parseDuration, timeTicks } from './duration'

describe('formatTime', () => {
  it('pads the seconds to two digits so 1:05 never reads as 1:5', () => {
    expect(formatTime(65)).toBe('1:05')
    expect(formatTime(42)).toBe('0:42')
  })

  it('does not pad the minutes, since the leading unit needs no alignment', () => {
    expect(formatTime(754)).toBe('12:34')
  })

  it('rolls into h:mm:ss past an hour, padding minutes once hours lead', () => {
    expect(formatTime(3661)).toBe('1:01:01')
  })

  it('floors fractional seconds rather than rounding, matching a ticking clock', () => {
    // The element reports 65.9s while 1:05 is still showing; rounding to 1:06
    // would jump the readout a second ahead of the bar.
    expect(formatTime(65.9)).toBe('1:05')
  })

  it('renders 0:00 before metadata loads, when duration is NaN or Infinity', () => {
    // onLoadedMetadata has not fired yet, so the <audio> duration is not a finite
    // number — a literal "NaN:aN" must never reach the UI.
    expect(formatTime(Number.NaN)).toBe('0:00')
    expect(formatTime(Number.POSITIVE_INFINITY)).toBe('0:00')
    expect(formatTime(-5)).toBe('0:00')
  })
})

describe('parseDuration', () => {
  // Discogs writes track lengths as "m:ss", the inverse of formatTime, so we can
  // compare a release's track length against the file's probed duration.
  it('parses m:ss into seconds', () => {
    expect(parseDuration('5:47')).toBe(347)
    expect(parseDuration('0:42')).toBe(42)
  })

  it('parses h:mm:ss into seconds for long mixes', () => {
    expect(parseDuration('1:01:01')).toBe(3661)
  })

  it('returns undefined when the duration is missing or unparseable', () => {
    // Many tracklist rows (headings, untimed tracks) carry no duration, and the
    // field is optional — an absent length must not read as 0 seconds, which would
    // score as wildly mismatched against every real file.
    expect(parseDuration(undefined)).toBeUndefined()
    expect(parseDuration('')).toBeUndefined()
    expect(parseDuration('?')).toBeUndefined()
  })
})

describe('timeTicks', () => {
  // The zoomed strip's ruler: ticks must land often enough to read a position at a
  // glance but never so dense the labels collide — the step widens with the visible
  // window (durationSec / zoom), snapping to clock-friendly intervals.
  it('spaces ticks to the visible window, on clock-friendly steps', () => {
    // 6-minute track, no zoom: whole minutes.
    const atOne = timeTicks(360, 1)
    expect(atOne.map((t) => t.sec)).toEqual([60, 120, 180, 240, 300])
    expect(atOne[0].label).toBe('1:00')
    // ×32 puts ~11 s in the panel: seconds-level ticks.
    const deep = timeTicks(360, 32)
    expect(deep[0].sec).toBe(2)
    expect(deep[1].sec).toBe(4)
    expect(deep.at(-1)?.sec).toBe(358)
  })

  it('places each tick as a percent of the whole strip', () => {
    const [first] = timeTicks(100, 1)
    expect(first.sec).toBe(15)
    expect(first.pct).toBe(15)
  })

  it('returns nothing for an empty decode', () => {
    expect(timeTicks(0, 8)).toEqual([])
  })
})
