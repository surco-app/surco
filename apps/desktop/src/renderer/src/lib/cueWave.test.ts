import { describe, expect, it } from 'vitest'
import { barLines, clickAction } from './cueWave'

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
})
