import { describe, expect, it } from 'vitest'
import { CALLS_ONLY, MY_FLOW, ONE_AT_32 } from '../../../shared/cueFlows'
import {
  EXAMPLE_DROP,
  EXAMPLE_DURATION_MS,
  EXAMPLE_GRID,
  EXAMPLE_WAVE,
  exampleBar,
  examplePlan,
} from './cueExample'

describe('the example wave', () => {
  const level = (from: number, to: number) => {
    const bars = EXAMPLE_WAVE.slice(from - 1, to)
    return bars.reduce((sum, c) => sum + c.h, 0) / bars.length
  }

  it('drops quiet in the bars before the point and breaks loud right on it, so the eye finds the drop at bar 64', () => {
    expect(level(52, 63)).toBeLessThan(level(40, 47) * 0.6)
    expect(level(52, 63)).toBeLessThan(level(64, 71) * 0.4)
  })

  it('has no later loud block as big as the drop, so nothing else reads as the drop', () => {
    const drop = Math.min(...EXAMPLE_WAVE.slice(63, 71).map((c) => c.h))
    expect(Math.max(...EXAMPLE_WAVE.slice(95).map((c) => c.h))).toBeLessThan(drop)
  })
})

describe('the example track', () => {
  it('draws no CALL on the example point for a flow that leaves it unmarked, as placing it would', () => {
    const out = examplePlan({ ...ONE_AT_32, markPoint: false })
    expect(out.status === 'plan' && out.wanted.some((c) => c.kind === 0)).toBe(false)
    expect(out.status === 'plan' && out.wanted.map((c) => c.ms)).toEqual([exampleBar(32)])
  })

  it('is 192 bars at 128 BPM with the drop at bar 64', () => {
    expect(EXAMPLE_GRID).toHaveLength(768)
    expect(EXAMPLE_GRID[1].ms - EXAMPLE_GRID[0].ms).toBe(469)
    expect(EXAMPLE_DROP).toBe(exampleBar(64))
    expect(EXAMPLE_DURATION_MS).toBe(360000)
  })

  it('numbers bars from 1 so the drop reads bar 64 beat 1', () => {
    const at = EXAMPLE_GRID.findIndex((b) => b.ms === EXAMPLE_DROP)
    expect(Math.floor(at / 4) + 1).toBe(64)
    expect(EXAMPLE_GRID[at].beat).toBe(1)
    expect(exampleBar(1)).toBe(0)
  })

  it('shows Mi flujo as the countdown Vicent knows', () => {
    const out = examplePlan(MY_FLOW)
    expect(out.status === 'plan' && out.hot.map((h) => [h.ms, h.color])).toEqual([
      [exampleBar(16), 42],
      [exampleBar(32), 22],
      [exampleBar(48), 1],
    ])
  })

  it('shows the other bundled flows doing what their names say', () => {
    const one = examplePlan(ONE_AT_32)
    expect(one.status === 'plan' && one.wanted).toEqual([
      { ms: EXAMPLE_DROP, kind: 0, color: null },
      { ms: exampleBar(32), kind: 1, color: 22 },
    ])
    const calls = examplePlan(CALLS_ONLY)
    expect(calls.status === 'plan' && calls.wanted).toEqual([
      { ms: EXAMPLE_DROP, kind: 0, color: null },
    ])
  })
})
