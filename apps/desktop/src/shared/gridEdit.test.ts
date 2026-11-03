import { describe, expect, it } from 'vitest'
import {
  downbeatAt,
  editableGridOf,
  fitGrid,
  gridBeats,
  gridOffsets,
  retempoGrid,
  shiftGrid,
} from './gridEdit'

const constantBeats = (bpm: number, from: number, count: number, firstBeat = 1) =>
  Array.from({ length: count }, (_, i) => ({
    ms: Math.round(from + (i * 60000) / bpm),
    beat: ((firstBeat - 1 + i) % 4) + 1,
  }))

describe('editableGridOf', () => {
  it('reads a constant rekordbox grid as its BPM and the first downbeat, so every edit starts from what the DJ has', () => {
    expect(editableGridOf(constantBeats(150, 46, 400))).toEqual({ bpm: 150, anchorMs: 46 })
  })

  it('keeps the hundredth of a BPM that rekordbox stores, because a 0.01 error is the drift the DJ came to fix', () => {
    expect(editableGridOf(constantBeats(150.04, 46, 400))?.bpm).toBe(150.04)
  })

  it('anchors on the first downbeat even when the grid starts mid-bar', () => {
    expect(editableGridOf(constantBeats(150, 46, 400, 3))?.anchorMs).toBe(846)
  })

  it('refuses a grid with two tempos, because flattening it would erase work the DJ did by hand', () => {
    const first = constantBeats(150, 46, 200)
    const last = first[first.length - 1].ms
    const second = constantBeats(140, last + 60000 / 140, 200, 1)
    expect(editableGridOf([...first, ...second])).toBeNull()
  })

  it('refuses fewer than two beats, since there is no tempo to read', () => {
    expect(editableGridOf([{ ms: 46, beat: 1 }])).toBeNull()
    expect(editableGridOf([])).toBeNull()
  })
})

describe('gridBeats', () => {
  it('draws the beats the program would draw, numbered within the bar', () => {
    const beats = gridBeats({ bpm: 150, anchorMs: 46 }, 2000)
    expect(beats.map((b) => b.ms)).toEqual([46, 446, 846, 1246, 1646])
    expect(beats.map((b) => b.beat)).toEqual([1, 2, 3, 4, 1])
  })

  it('keeps the bar numbering when the anchor is moved before the start of the track', () => {
    const beats = gridBeats({ bpm: 150, anchorMs: -354 }, 1000)
    expect(beats[0]).toEqual({ ms: 46, beat: 2 })
  })
})

describe('shiftGrid', () => {
  it('moves the whole grid without touching the tempo', () => {
    expect(shiftGrid({ bpm: 150, anchorMs: 46 }, -10)).toEqual({ bpm: 150, anchorMs: 36 })
  })
})

describe('retempoGrid', () => {
  it('keeps the beat nearest the playhead where it is, so what the DJ is looking at does not jump', () => {
    const grid = retempoGrid({ bpm: 150, anchorMs: 0 }, 149.99, 4000)
    expect(grid).not.toBeNull()
    const nearest = gridBeats(grid as NonNullable<typeof grid>, 10000).reduce((a, b) =>
      Math.abs(b.ms - 4000) < Math.abs(a.ms - 4000) ? b : a,
    )
    expect(Math.abs(nearest.ms - 4000)).toBeLessThanOrEqual(0.5)
    expect(nearest.beat).toBe(3)
  })

  it('refuses a tempo outside 40 to 300 BPM', () => {
    expect(retempoGrid({ bpm: 150, anchorMs: 0 }, 301, 0)).toBeNull()
    expect(retempoGrid({ bpm: 150, anchorMs: 0 }, 39, 0)).toBeNull()
  })
})

describe('downbeatAt', () => {
  it('puts a downbeat exactly at the playhead', () => {
    const beats = gridBeats(downbeatAt({ bpm: 150, anchorMs: 46 }, 1000), 3000)
    expect(beats).toContainEqual({ ms: 1000, beat: 1 })
  })
})

describe('fitGrid', () => {
  it('lands on the detected beats but keeps the DJ downbeat nearest the old one, since the detector cannot find the bar', () => {
    expect(fitGrid({ bpm: 150, anchorMs: 46 }, { bpm: 150, firstMs: 10 })).toEqual({
      bpm: 150,
      anchorMs: 10,
    })
    expect(fitGrid({ bpm: 150, anchorMs: 1246 }, { bpm: 150, firstMs: 10 }).anchorMs).toBe(1210)
  })

  it('takes the detected BPM when it is within 1% of the DJ one', () => {
    expect(fitGrid({ bpm: 150, anchorMs: 46 }, { bpm: 150.04, firstMs: 10 }).bpm).toBe(150.04)
  })

  it('keeps the DJ BPM when the detector found double or half, and only fixes the phase', () => {
    const grid = fitGrid({ bpm: 150, anchorMs: 46 }, { bpm: 300, firstMs: 10 })
    expect(grid.bpm).toBe(150)
    expect(grid.anchorMs).toBe(10)
  })
})

describe('gridOffsets', () => {
  it('shows the same offset here and at the end for a shifted grid, the common case', () => {
    expect(
      gridOffsets({ bpm: 150, anchorMs: 46 }, { bpm: 150, firstMs: 0 }, 26500, 345000),
    ).toEqual({
      hereMs: 46,
      endMs: 46,
    })
  })

  it('shows the offset growing towards the end when the BPM is a hundredth off, so the DJ knows to touch the tempo', () => {
    const { hereMs, endMs } = gridOffsets(
      { bpm: 150.01, anchorMs: 0 },
      { bpm: 150, firstMs: 0 },
      0,
      345000,
    )
    expect(hereMs).toBe(0)
    expect(Math.abs(endMs + 23)).toBeLessThanOrEqual(1)
  })
})
