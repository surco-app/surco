import { describe, expect, it } from 'vitest'
import { CALLS_ONLY, MY_FLOW, ONE_AT_32 } from '../../../shared/cueFlows'
import {
  EXAMPLE_DROP,
  EXAMPLE_DURATION_MS,
  EXAMPLE_GRID,
  exampleBar,
  examplePlan,
} from './cueExample'

describe('the example track', () => {
  it('is 192 bars at 128 BPM with the drop at bar 64', () => {
    expect(EXAMPLE_GRID).toHaveLength(768)
    expect(EXAMPLE_GRID[1].ms - EXAMPLE_GRID[0].ms).toBe(469)
    expect(EXAMPLE_DROP).toBe(exampleBar(64))
    expect(EXAMPLE_DURATION_MS).toBe(360000)
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
