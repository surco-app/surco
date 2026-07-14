import { describe, expect, it } from 'vitest'
import { gridSegments, normalizeBeatgrid, outputBeatgrid, snapAnchor } from './beatgrid'

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

  // A lattice may legitimately start before the file does: nudge a grid that was
  // anchored a few milliseconds in and the anchor crosses zero. Folding it by a
  // beat to keep it positive states the same grid but jumps every line a beat to
  // the right on screen, so the editor keeps it negative and only the exports
  // fold. Storing it therefore has to survive a session round-trip.
  it('keeps a negative anchor, the lattice starting before the file', () => {
    expect(normalizeBeatgrid({ bpm: 128, anchorSec: -0.1 })).toEqual({
      bpm: 128,
      anchorSec: -0.1,
    })
  })

  // Multi-segment grids ride the same stored value, so the changes list gets
  // the same degrade-not-error treatment — entry by entry, because one typo in
  // a hand-edited session.json must not throw away the segments that are fine.
  it('passes valid tempo changes through', () => {
    expect(
      normalizeBeatgrid({
        bpm: 128,
        anchorSec: 0.25,
        changes: [
          { anchorSec: 60, bpm: 128 },
          { anchorSec: 120.5, bpm: 127.8 },
        ],
      }),
    ).toEqual({
      bpm: 128,
      anchorSec: 0.25,
      changes: [
        { anchorSec: 60, bpm: 128 },
        { anchorSec: 120.5, bpm: 127.8 },
      ],
    })
  })

  it('drops malformed, out-of-order or pre-anchor changes but keeps the rest', () => {
    expect(
      normalizeBeatgrid({
        bpm: 128,
        anchorSec: 0.25,
        changes: [
          { anchorSec: 0.1, bpm: 128 },
          { anchorSec: 60, bpm: 128 },
          { anchorSec: 30, bpm: 128 },
          { anchorSec: 90, bpm: Number.NaN },
          { anchorSec: 120, bpm: 130 },
          'garbage',
        ],
      }),
    ).toEqual({
      bpm: 128,
      anchorSec: 0.25,
      changes: [
        { anchorSec: 60, bpm: 128 },
        { anchorSec: 120, bpm: 130 },
      ],
    })
  })

  it('omits the changes key when nothing valid remains', () => {
    expect(normalizeBeatgrid({ bpm: 128, anchorSec: 0.25, changes: [] })).toEqual({
      bpm: 128,
      anchorSec: 0.25,
    })
    expect(normalizeBeatgrid({ bpm: 128, anchorSec: 0.25, changes: 'x' })).toEqual({
      bpm: 128,
      anchorSec: 0.25,
    })
  })
})

describe('gridSegments', () => {
  // The one walk every consumer shares: base plus changes as ordered segments.
  it('lists the base grid and each change in order', () => {
    expect(
      gridSegments({ bpm: 128, anchorSec: 0.25, changes: [{ anchorSec: 60, bpm: 130 }] }),
    ).toEqual([
      { anchorSec: 0.25, bpm: 128 },
      { anchorSec: 60, bpm: 130 },
    ])
    expect(gridSegments({ bpm: 128, anchorSec: 0.25 })).toEqual([{ anchorSec: 0.25, bpm: 128 }])
  })
})

describe('outputBeatgrid', () => {
  it('keeps a grid with no trim untouched', () => {
    const grid = { bpm: 128, anchorSec: 0.25, changes: [{ anchorSec: 60, bpm: 130 }] }
    expect(outputBeatgrid(grid, undefined)).toBe(grid)
  })

  // The editor hands over lattices anchored before the file starts (nudging the
  // anchor past zero). Serato, Engine and rekordbox all state the grid by its
  // first beat and none can write a negative one, so the fold the editor skips
  // has to happen here — including with nothing trimmed, which was the untouched
  // passthrough above.
  it('folds an anchor that starts before the file onto its first beat', () => {
    expect(outputBeatgrid({ bpm: 120, anchorSec: -0.1 }, undefined)).toEqual({
      bpm: 120,
      anchorSec: 0.4,
    })
  })

  it('shifts every anchor by the trimmed head', () => {
    expect(
      outputBeatgrid(
        { bpm: 120, anchorSec: 10, changes: [{ anchorSec: 60, bpm: 121 }] },
        { startSec: 5 },
      ),
    ).toEqual({ bpm: 120, anchorSec: 5, changes: [{ anchorSec: 55, bpm: 121 }] })
  })

  // A cut landing INSIDE a later segment must re-base on that segment — its
  // bpm, its beat phase — and drop the changes the cut swallowed: the exported
  // file starts under that segment's grid, not under the long-gone base.
  it('re-bases on the segment the cut lands in', () => {
    const out = outputBeatgrid(
      {
        bpm: 120,
        anchorSec: 0,
        changes: [
          { anchorSec: 60, bpm: 150 },
          { anchorSec: 120, bpm: 152 },
        ],
      },
      { startSec: 61 },
    )
    // 61 s is 2.5 beats into the 150 BPM segment (period 0.4): first surviving
    // beat 0.2 s into the output.
    expect(out?.bpm).toBe(150)
    expect(out?.anchorSec).toBeCloseTo(0.2, 10)
    expect(out?.changes).toEqual([{ anchorSec: 59, bpm: 152 }])
  })

  it('re-bases cleanly when the cut sits exactly on a change', () => {
    const out = outputBeatgrid(
      { bpm: 120, anchorSec: 0, changes: [{ anchorSec: 60, bpm: 150 }] },
      { startSec: 60 },
    )
    expect(out).toEqual({ bpm: 150, anchorSec: 0 })
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
