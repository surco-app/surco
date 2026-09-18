import { describe, expect, it } from 'vitest'
import {
  NORMALIZE_BEFORE_MS,
  NORMALIZE_WARM_MS,
  OPS,
  STOPWATCH_END,
  stopwatchFrame,
} from './stopwatch'

describe('stopwatchFrame', () => {
  // The whole claim of the section is that the bars run at real time: at t ms, the
  // operations that fit in t are done and the one in flight is exactly as far along as
  // t says. Anything else would be a dramatisation, which is what the section is not.
  it('runs the operations one after another at real time', () => {
    const first = OPS[0].ms
    const midSecond = first + OPS[1].ms / 2
    const frame = stopwatchFrame(midSecond)
    expect(frame.rows[0]).toEqual({ progress: 1, elapsedMs: first, running: false, done: true })
    expect(frame.rows[1].running).toBe(true)
    expect(frame.rows[1].progress).toBeCloseTo(0.5)
    expect(frame.rows[1].elapsedMs).toBe(Math.round(OPS[1].ms / 2))
    expect(frame.rows[2]).toEqual({ progress: 0, elapsedMs: 0, running: false, done: false })
  })

  it('starts with nothing done and ends with every operation complete', () => {
    const start = stopwatchFrame(0)
    expect(start.elapsedMs).toBe(0)
    expect(start.rows.every((r) => !r.done && !r.running)).toBe(true)

    const end = stopwatchFrame(STOPWATCH_END)
    expect(end.done).toBe(true)
    expect(end.rows.every((r) => r.done)).toBe(true)
    expect(end.rows.map((r) => r.elapsedMs)).toEqual(OPS.map((op) => op.ms))
  })

  it('clamps past the end instead of overshooting', () => {
    expect(stopwatchFrame(STOPWATCH_END * 3)).toEqual(stopwatchFrame(STOPWATCH_END))
    expect(stopwatchFrame(-50)).toEqual(stopwatchFrame(0))
  })

  it('is a pure function of t', () => {
    expect(stopwatchFrame(700)).toEqual(stopwatchFrame(700))
  })

  // The two normalization figures on the page are claims about the same operation,
  // so they have to stay consistent with the lane that animates it.
  it('keeps the normalization figures ordered: warm under cold under the old cost', () => {
    const cold = OPS.find((op) => op.key === 'normalize')?.ms ?? 0
    expect(NORMALIZE_WARM_MS).toBeLessThan(cold)
    expect(cold).toBeLessThan(NORMALIZE_BEFORE_MS)
  })
})
