import { describe, expect, it } from 'vitest'
import { normalizeBeatgrid, snapAnchor } from './beatgrid'

describe('normalizeBeatgrid', () => {
  it('passes a valid grid through', () => {
    expect(normalizeBeatgrid({ bpm: 128, anchorSec: 0.25 })).toEqual({
      bpm: 128,
      anchorSec: 0.25,
    })
    expect(normalizeBeatgrid({ bpm: 92.5, anchorSec: 0 })).toEqual({ bpm: 92.5, anchorSec: 0 })
  })

  // session.json is hand-editable: anything that isn't a usable grid degrades to
  // "no grid" instead of poisoning the overlay math or the DJ exports.
  it('degrades malformed values to undefined', () => {
    expect(normalizeBeatgrid(undefined)).toBeUndefined()
    expect(normalizeBeatgrid(null)).toBeUndefined()
    expect(normalizeBeatgrid('128')).toBeUndefined()
    expect(normalizeBeatgrid({})).toBeUndefined()
    expect(normalizeBeatgrid({ bpm: 128 })).toBeUndefined()
    expect(normalizeBeatgrid({ anchorSec: 0.25 })).toBeUndefined()
    expect(normalizeBeatgrid({ bpm: 'x', anchorSec: 0.25 })).toBeUndefined()
    expect(normalizeBeatgrid({ bpm: Number.NaN, anchorSec: 0.25 })).toBeUndefined()
    expect(normalizeBeatgrid({ bpm: 128, anchorSec: Number.POSITIVE_INFINITY })).toBeUndefined()
  })

  // A bpm outside anything a DJ deck displays would render as a wall of grid
  // lines (or one line per song) and export a grid no software can use.
  it('rejects bpm outside the sane range', () => {
    expect(normalizeBeatgrid({ bpm: 0, anchorSec: 0 })).toBeUndefined()
    expect(normalizeBeatgrid({ bpm: -128, anchorSec: 0 })).toBeUndefined()
    expect(normalizeBeatgrid({ bpm: 19, anchorSec: 0 })).toBeUndefined()
    expect(normalizeBeatgrid({ bpm: 1000, anchorSec: 0 })).toBeUndefined()
    expect(normalizeBeatgrid({ bpm: 20, anchorSec: 0 })).toEqual({ bpm: 20, anchorSec: 0 })
    expect(normalizeBeatgrid({ bpm: 999, anchorSec: 0 })).toEqual({ bpm: 999, anchorSec: 0 })
  })

  it('rejects a negative anchor', () => {
    expect(normalizeBeatgrid({ bpm: 128, anchorSec: -0.1 })).toBeUndefined()
  })
})

describe('snapAnchor', () => {
  it('keeps an anchor already inside the first beat period', () => {
    expect(snapAnchor(0.25, 120)).toBeCloseTo(0.25, 10)
    expect(snapAnchor(0, 120)).toBe(0)
  })

  // Nudging back past zero or offsetting by a trim must land on the same grid,
  // expressed as its first non-negative beat — never a negative time.
  it('folds by whole beats into [0, 60/bpm)', () => {
    expect(snapAnchor(1.25, 120)).toBeCloseTo(0.25, 10)
    expect(snapAnchor(-0.25, 120)).toBeCloseTo(0.25, 10)
    expect(snapAnchor(-1.75, 120)).toBeCloseTo(0.25, 10)
  })

  it('treats an anchor exactly one period out as phase zero', () => {
    expect(snapAnchor(0.5, 120)).toBeCloseTo(0, 10)
    expect(snapAnchor(-0.5, 120)).toBeCloseTo(0, 10)
  })
})
