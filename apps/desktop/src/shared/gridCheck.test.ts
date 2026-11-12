import { describe, expect, it } from 'vitest'
import { checkGrid, needsGridFix } from './gridCheck'

const BPM = 145
const DURATION_MS = 300000
const SHORT_DURATION_MS = 120000

const beatsOf = (from: number, durationMs = DURATION_MS) =>
  Array.from({ length: Math.floor(durationMs / (60000 / BPM)) }, (_, i) => from + (i * 60000) / BPM)

const phasesAt = (firstMs: (ms: number) => number) =>
  Array.from({ length: 18 }, (_, i) => {
    const ms = 3200 + i * 6400
    return { ms, firstMs: firstMs(ms) }
  })

const checkShifted = (shiftMs: number) =>
  checkGrid({
    beats: beatsOf(shiftMs),
    kicks: beatsOf(0),
    fit: { bpm: BPM, firstMs: 0 },
    atMs: 0,
    durationMs: DURATION_MS,
  })

describe('needsGridFix', () => {
  it('flags a grid 102 ms off the kicks, which the old verdict missed', () => {
    const check = checkShifted(102)
    expect(check.verdict).toBeNull()
    expect(check.worstMs).toBeGreaterThanOrEqual(100)
    expect(check.worstMs).toBeLessThanOrEqual(104)
    expect(needsGridFix(check, 10)).toBe(true)
  })

  it('leaves a grid within tolerance alone', () => {
    const check = checkShifted(7)
    expect(needsGridFix(check, 10)).toBe(false)
    expect(needsGridFix(check, 5)).toBe(true)
  })

  it('flags a drifting grid even when start and end sit inside tolerance', () => {
    const check = checkGrid({
      beats: beatsOf(0, SHORT_DURATION_MS),
      kicks: beatsOf(0, SHORT_DURATION_MS),
      fit: { bpm: BPM, firstMs: 0, phases: phasesAt((ms) => (4 * ms) / 60000) },
      atMs: 0,
      durationMs: SHORT_DURATION_MS,
    })
    expect(check.worstMs).toBeLessThanOrEqual(10)
    expect(check.verdict?.kind).toBe('drifting')
    expect(needsGridFix(check, 10)).toBe(true)
  })
})
