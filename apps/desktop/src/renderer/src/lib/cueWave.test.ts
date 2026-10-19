import { describe, expect, it } from 'vitest'
import { barLines, clickAction, cuePosition, dropLabels } from './cueWave'

const GRID = Array.from({ length: 160 }, (_, i) => ({ ms: i * 500, beat: (i % 4) + 1 }))
const BEATS = GRID.map((b) => b.ms)

describe('barLines', () => {
  it('marks every bar and every 16th strongly', () => {
    const lines = barLines(GRID)
    expect(lines).toHaveLength(40)
    expect(lines[0]).toEqual({ ms: 0, strong: true })
    expect(lines[1]).toEqual({ ms: 2000, strong: false })
    expect(lines[16]).toEqual({ ms: 32000, strong: true })
  })
})

describe('clickAction', () => {
  it('adds a drop on the nearest beat', () => {
    expect(clickAction(1240, BEATS, [], 100)).toEqual({ kind: 'add', ms: 1000 })
  })

  it('removes the drop under the click', () => {
    expect(clickAction(10040, BEATS, [10000], 100)).toEqual({ kind: 'remove', ms: 10000 })
  })

  it('snaps a click before the grid to its first beat', () => {
    const late = BEATS.map((ms) => ms + 300)
    expect(clickAction(10, late, [], 100)).toEqual({ kind: 'add', ms: 300 })
  })

  it('removes the drop whose beat a click snaps to instead of adding a second one there', () => {
    const wide = Array.from({ length: 100 }, (_, i) => i * 1000)
    expect(clickAction(10300, wide, [10000], 100)).toEqual({ kind: 'remove', ms: 10000 })
  })

  it('removes the nearest of two drops under the click', () => {
    expect(clickAction(40080, BEATS, [40000, 40100], 600)).toEqual({ kind: 'remove', ms: 40100 })
  })
})

describe('cuePosition', () => {
  it('names the beat as time to the millisecond and bar.beat, so the user sees which beat a click took', () => {
    expect(cuePosition(4500, GRID)).toEqual({ time: '0:04.500', bar: '3.2' })
    expect(cuePosition(0, GRID)).toEqual({ time: '0:00.000', bar: '1.1' })
  })

  it('writes minutes past the first and pads seconds and milliseconds', () => {
    const grid = [
      { ms: 174764, beat: 1 },
      { ms: 175153, beat: 2 },
    ]
    expect(cuePosition(175153, grid)).toEqual({ time: '2:55.153', bar: '1.2' })
  })

  it('counts beats before the first downbeat as bar 0', () => {
    const grid = [
      { ms: 0, beat: 3 },
      { ms: 500, beat: 4 },
      { ms: 1000, beat: 1 },
    ]
    expect(cuePosition(500, grid).bar).toBe('0.4')
    expect(cuePosition(1000, grid).bar).toBe('1.1')
  })
})

describe('dropLabels', () => {
  it('puts a label right of its drop on one row when nothing is near', () => {
    expect(dropLabels([10000, 40000], 80000)).toEqual([
      { ms: 10000, side: 'right', row: 0 },
      { ms: 40000, side: 'right', row: 0 },
    ])
  })

  it('puts the label left of a drop near the end so the edge does not clip it', () => {
    expect(dropLabels([76000], 80000)).toEqual([{ ms: 76000, side: 'left', row: 0 }])
  })

  it('moves a label down a row when the drop before is too close for both to read', () => {
    expect(dropLabels([40000, 42000, 44000], 80000).map((l) => l.row)).toEqual([0, 1, 0])
  })

  it('stacks an end label that turned left onto the label it would run into', () => {
    expect(dropLabels([60000, 74000], 80000)).toEqual([
      { ms: 60000, side: 'right', row: 0 },
      { ms: 74000, side: 'left', row: 1 },
    ])
    expect(dropLabels([40000, 76000], 80000).map((l) => l.row)).toEqual([0, 0])
  })
})
