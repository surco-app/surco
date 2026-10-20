import { describe, expect, it } from 'vitest'
import { barLines, cuePosition, quantizePoints } from './cueWave'

const GRID = Array.from({ length: 160 }, (_, i) => ({ ms: i * 500, beat: (i % 4) + 1 }))
const BEATS = GRID.map((b) => b.ms)

describe('barLines', () => {
  it('marks every bar on its downbeat', () => {
    const lines = barLines(GRID)
    expect(lines).toHaveLength(40)
    expect(lines[0]).toEqual({ ms: 0 })
    expect(lines[16]).toEqual({ ms: 32000 })
  })
})

describe('quantizePoints', () => {
  it('offers only the bar starts when quantizing to the bar, so a cue lands where a phrase begins', () => {
    const points = quantizePoints(GRID, 'bar')
    expect(points).toHaveLength(40)
    expect(points.slice(0, 3)).toEqual([0, 2000, 4000])
  })

  it('offers every beat when quantizing to the beat', () => {
    expect(quantizePoints(GRID, 'beat')).toEqual(BEATS)
  })

  it('falls back to the beats when the grid has no bar start, so a cue still lands on the grid', () => {
    const noDownbeat = [
      { ms: 0, beat: 2 },
      { ms: 500, beat: 3 },
    ]
    expect(quantizePoints(noDownbeat, 'bar')).toEqual([0, 500])
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
