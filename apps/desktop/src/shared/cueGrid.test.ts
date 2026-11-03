import { describe, expect, it } from 'vitest'
import {
  CUE_GRID_TOLERANCE,
  cueGridDrift,
  DEFAULT_CUE_GRID_TOLERANCE,
  normalizeCueGridTolerance,
} from './cueGrid'

const beatsAt120 = (from: number, count: number) =>
  Array.from({ length: count }, (_, i) => from + i * 500)

describe('cueGridDrift', () => {
  it('measures nothing for cues sitting on a beat, because those are the ones a quantized DJ app placed', () => {
    expect(cueGridDrift([100, 1100, 3100], beatsAt120(100, 10))).toBe(0)
  })

  it('reports the cue furthest from its beat, since that is the one that fires off the beat', () => {
    expect(cueGridDrift([111, 1350, 2095], beatsAt120(100, 10))).toBe(250)
    expect(cueGridDrift([111, 2095], beatsAt120(100, 10))).toBe(11)
  })

  it('measures a cue before the first beat against where the grid would continue backwards', () => {
    expect(cueGridDrift([0], beatsAt120(500, 10))).toBe(0)
    expect(cueGridDrift([0], beatsAt120(250, 10))).toBe(250)
  })

  it('measures a cue past the last beat against where the grid would continue forwards', () => {
    expect(cueGridDrift([100 + 12 * 500], beatsAt120(100, 10))).toBe(0)
    expect(cueGridDrift([100 + 12 * 500 + 30], beatsAt120(100, 10))).toBe(30)
  })

  it('follows a grid whose tempo changes, as rekordbox writes each beat on its own', () => {
    const beats = [0, 500, 1000, 1400, 1800, 2200]
    expect(cueGridDrift([1400, 2200], beats)).toBe(0)
    expect(cueGridDrift([1200], beats)).toBe(200)
  })

  it('measures nothing without a grid or without cues, because there is nothing to compare', () => {
    expect(cueGridDrift([1234], [])).toBeNull()
    expect(cueGridDrift([1234], [500])).toBeNull()
    expect(cueGridDrift([], beatsAt120(0, 10))).toBeNull()
  })
})

describe('normalizeCueGridTolerance', () => {
  it('keeps each tolerance the Cues tab offers', () => {
    for (const ms of CUE_GRID_TOLERANCE) expect(normalizeCueGridTolerance(ms)).toBe(ms)
  })

  it('falls back to 10 ms, the drift a DJ already sees on the wave, for anything else a file holds', () => {
    for (const value of [undefined, null, 0, 7, '10', {}]) {
      expect(normalizeCueGridTolerance(value)).toBe(DEFAULT_CUE_GRID_TOLERANCE)
    }
    expect(DEFAULT_CUE_GRID_TOLERANCE).toBe(10)
  })
})
