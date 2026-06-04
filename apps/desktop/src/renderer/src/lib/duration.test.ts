import { describe, expect, it } from 'vitest'
import { formatTime } from './duration'

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
