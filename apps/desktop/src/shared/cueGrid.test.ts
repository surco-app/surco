import { describe, expect, it } from 'vitest'
import { cuesOffGrid, OFF_GRID_TOLERANCE_MS } from './cueGrid'

const beatsAt120 = (from: number, count: number) =>
  Array.from({ length: count }, (_, i) => from + i * 500)

describe('cuesOffGrid', () => {
  it('passes cues sitting on a beat, because those are the ones a quantized DJ app placed', () => {
    expect(cuesOffGrid([100, 1100, 3100], beatsAt120(100, 10))).toBe(false)
  })

  it('flags a track when one cue lands between beats, since that cue will fire off the beat', () => {
    expect(cuesOffGrid([100, 1350], beatsAt120(100, 10))).toBe(true)
  })

  it('forgives drift up to the tolerance, because stored positions round to the millisecond', () => {
    const beats = beatsAt120(100, 10)
    expect(cuesOffGrid([600 + OFF_GRID_TOLERANCE_MS], beats)).toBe(false)
    expect(cuesOffGrid([600 - OFF_GRID_TOLERANCE_MS], beats)).toBe(false)
    expect(cuesOffGrid([600 + OFF_GRID_TOLERANCE_MS + 1], beats)).toBe(true)
  })

  it('accepts a cue before the first beat when it falls where the grid would continue backwards', () => {
    expect(cuesOffGrid([0], beatsAt120(500, 10))).toBe(false)
    expect(cuesOffGrid([0], beatsAt120(250, 10))).toBe(true)
  })

  it('accepts a cue past the last beat when it falls where the grid would continue forwards', () => {
    expect(cuesOffGrid([100 + 12 * 500], beatsAt120(100, 10))).toBe(false)
    expect(cuesOffGrid([100 + 12 * 500 + 250], beatsAt120(100, 10))).toBe(true)
  })

  it('follows a grid whose tempo changes, as rekordbox writes each beat on its own', () => {
    const beats = [0, 500, 1000, 1400, 1800, 2200]
    expect(cuesOffGrid([1400, 2200], beats)).toBe(false)
    expect(cuesOffGrid([1200], beats)).toBe(true)
  })

  it('never flags a track without a grid, because there is nothing to measure the cues against', () => {
    expect(cuesOffGrid([1234], [])).toBe(false)
    expect(cuesOffGrid([1234], [500])).toBe(false)
  })

  it('never flags a track without cues', () => {
    expect(cuesOffGrid([], beatsAt120(0, 10))).toBe(false)
  })
})
