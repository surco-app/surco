import { describe, expect, it } from 'vitest'
import { DEFAULT_DECLICK, declickFilter, normalizeDeclick } from './declick'

describe('declickFilter', () => {
  it('returns no filter when off, so a plain conversion stays untouched', () => {
    expect(declickFilter('off')).toBeNull()
  })

  // One intensity ladder, each step calibrated: gentle raises the detection
  // threshold (touches ~0.45% of a clean commercial track vs standard's 6.3%,
  // synthetic clicks still repair fully), standard is adeclick's own defaults, and
  // strong adds the minimal burst fusion that also repairs long pops. The two knobs
  // NOT on the ladder stay out for measured reasons: t below 2 and b above 4 both
  // explode the repair cost past realtime — the "hung conversion" reports, twice.
  it('maps each intensity step to its calibrated filter', () => {
    expect(declickFilter('soft')).toBe('adeclick=t=4')
    expect(declickFilter('standard')).toBe('adeclick')
    expect(declickFilter('strong')).toBe('adeclick=b=4')
  })
})

describe('normalizeDeclick', () => {
  it('returns the default for a missing value', () => {
    expect(normalizeDeclick(undefined)).toBe(DEFAULT_DECLICK)
  })

  it('keeps a valid stored mode, including the 0.49-0.50 values', () => {
    expect(normalizeDeclick('off')).toBe('off')
    expect(normalizeDeclick('soft')).toBe('soft')
    expect(normalizeDeclick('standard')).toBe('standard')
    expect(normalizeDeclick('strong')).toBe('strong')
  })

  // A dev build briefly stored {mode, sensitivity}; its mode survives, the extra
  // dial is gone (the ladder covers its one useful position as 'soft').
  it('reads the short-lived config-object shape down to its mode', () => {
    expect(normalizeDeclick({ mode: 'strong', sensitivity: 3 })).toBe('strong')
  })

  it('repairs an unrecognized value to the default', () => {
    expect(normalizeDeclick('bogus')).toBe(DEFAULT_DECLICK)
    expect(normalizeDeclick({ mode: 'bogus' })).toBe(DEFAULT_DECLICK)
    expect(normalizeDeclick(42)).toBe(DEFAULT_DECLICK)
  })
})
