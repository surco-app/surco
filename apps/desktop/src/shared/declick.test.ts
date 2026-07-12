import { describe, expect, it } from 'vitest'
import { DEFAULT_DECLICK, declickFilter, normalizeDeclick } from './declick'

describe('declickFilter', () => {
  it('returns no filter when off, so a plain conversion stays untouched', () => {
    expect(declickFilter({ mode: 'off', sensitivity: 5 })).toBeNull()
  })

  it('uses adeclick defaults for standard clicks at full sensitivity', () => {
    expect(declickFilter({ mode: 'standard', sensitivity: 5 })).toBe('adeclick')
  })

  it('adds the minimal burst fusion in strong mode', () => {
    expect(declickFilter({ mode: 'strong', sensitivity: 5 })).toBe('adeclick=b=4')
  })

  // Sensitivity only ever RAISES the detection threshold above adeclick's default:
  // t below 2 is the hang zone (measured: t=1 never finished 30 s of audio), so the
  // slider's floor is the filter's own default, by construction.
  it('maps lower sensitivity to a higher threshold, never below the default', () => {
    expect(declickFilter({ mode: 'standard', sensitivity: 4 })).toBe('adeclick=t=3')
    expect(declickFilter({ mode: 'standard', sensitivity: 3 })).toBe('adeclick=t=4')
    expect(declickFilter({ mode: 'standard', sensitivity: 1 })).toBe('adeclick=t=6')
    expect(declickFilter({ mode: 'strong', sensitivity: 3 })).toBe('adeclick=t=4:b=4')
  })

  it('clamps an out-of-range sensitivity into the safe band', () => {
    expect(declickFilter({ mode: 'standard', sensitivity: 99 })).toBe('adeclick')
    expect(declickFilter({ mode: 'standard', sensitivity: -2 })).toBe('adeclick=t=6')
  })
})

describe('normalizeDeclick', () => {
  it('returns the default for a missing value', () => {
    expect(normalizeDeclick(undefined)).toEqual(DEFAULT_DECLICK)
  })

  // Settings written by 0.49-0.50 store the mode as a bare string; they must read
  // as that mode at full sensitivity, never reset to off.
  it('upgrades the old bare-string mode from a stored settings file', () => {
    expect(normalizeDeclick('strong')).toEqual({ mode: 'strong', sensitivity: 5 })
    expect(normalizeDeclick('off')).toEqual({ mode: 'off', sensitivity: 5 })
  })

  it('keeps a valid config as it is', () => {
    expect(normalizeDeclick({ mode: 'standard', sensitivity: 3 })).toEqual({
      mode: 'standard',
      sensitivity: 3,
    })
  })

  it('repairs a hand-edited config field by field', () => {
    expect(normalizeDeclick({ mode: 'bogus', sensitivity: 'x' })).toEqual(DEFAULT_DECLICK)
    expect(normalizeDeclick({ mode: 'strong' })).toEqual({ mode: 'strong', sensitivity: 5 })
    expect(normalizeDeclick({ mode: 'standard', sensitivity: 42 })).toEqual({
      mode: 'standard',
      sensitivity: 5,
    })
  })
})
