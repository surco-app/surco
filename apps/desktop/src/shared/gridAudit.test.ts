import { describe, expect, it } from 'vitest'
import { checkOfAudit, type GridAudit, gridVerdictOf, needsGridFix } from './gridAudit'

const PERIOD = 60000 / 140
const STEP_MS = 8 * PERIOD

const auditOf = (offsets: number[], extra: Partial<GridAudit> = {}): GridAudit => ({
  windows: offsets.map((offsetMs, i) => ({ ms: (i + 1) * STEP_MS, offsetMs })),
  total: offsets.length,
  periodMs: PERIOD,
  heardPerMinute: 30,
  ...extra,
})

const steady = (ms: number, n = 40) => Array.from({ length: n }, () => ms)

describe('checkOfAudit', () => {
  it('passes a grid whose hits all sit within the tolerance, so a good grid stays out of the filter', () => {
    const check = checkOfAudit(auditOf(steady(4)))
    expect(needsGridFix(check, 10)).toBe(false)
  })

  it('flags a grid laid off the hit all along, with how far', () => {
    const check = checkOfAudit(auditOf(steady(-22)))
    expect(needsGridFix(check, 10)).toBe(true)
    expect(gridVerdictOf(check, 10)).toEqual({ kind: 'shifted', ms: -22 })
  })

  it('flags a grid that drifts off the hit in part of the track, where cues there would miss', () => {
    const drift = Array.from({ length: 40 }, (_, i) => (i < 20 ? 0 : (i - 20) * 1.5))
    const check = checkOfAudit(auditOf(drift))
    expect(needsGridFix(check, 10)).toBe(true)
    expect(gridVerdictOf(check, 10)?.kind).toBe('partial')
  })

  it('ignores a short stretch that jumps to another instrument, which is the music changing, not the grid', () => {
    const offsets = steady(1)
    offsets.splice(15, 5, 76, 76, 78, 76, 76)
    expect(needsGridFix(checkOfAudit(auditOf(offsets)), 10)).toBe(false)
  })

  it('keeps following a drift across a long gap without a clear beat, so a slow drift is not taken for a jump', () => {
    const audit = auditOf([])
    const lastClear = 20 * STEP_MS
    audit.windows = [
      ...Array.from({ length: 20 }, (_, i) => ({ ms: (i + 1) * STEP_MS, offsetMs: 0 })),
      ...Array.from({ length: 6 }, (_, i) => ({
        ms: lastClear + 90000 + i * STEP_MS,
        offsetMs: 30 + i,
      })),
    ]
    audit.total = 40
    expect(gridVerdictOf(checkOfAudit(audit), 10)?.kind).toBe('partial')
  })

  it('follows a drift past a quarter beat, where the folded reading flips sign', () => {
    const drift = Array.from({ length: 40 }, (_, i) => {
      const ms = 60 + i * 2
      return ms > PERIOD / 4 ? ms - PERIOD / 2 : ms
    })
    const verdict = gridVerdictOf(checkOfAudit(auditOf(drift)), 10)
    expect(verdict).toEqual({ kind: 'shifted', ms: expect.any(Number) })
    expect(verdict?.kind === 'shifted' && verdict.ms).toBeGreaterThan(90)
  })

  it('follows a drift past a quarter beat the other way too', () => {
    const drift = Array.from({ length: 40 }, (_, i) => {
      const ms = -60 - i * 2
      return ms < -PERIOD / 4 ? ms + PERIOD / 2 : ms
    })
    const verdict = gridVerdictOf(checkOfAudit(auditOf(drift)), 10)
    expect(verdict?.kind === 'shifted' && verdict.ms).toBeLessThan(-90)
  })

  it('judges nothing where the beat cannot be heard, so an a cappella is never blamed on its grid', () => {
    const check = checkOfAudit(auditOf(steady(40, 4), { total: 40, heardPerMinute: 2 }))
    expect(check.kind).toBe('unmeasured')
    expect(needsGridFix(check, 10)).toBe(false)
  })

  it('blames the grid tempo when the beat is clear to Surco but smears on the grid', () => {
    const check = checkOfAudit(auditOf(steady(0, 4), { total: 40, heardPerMinute: 26 }))
    expect(needsGridFix(check, 10)).toBe(true)
    expect(gridVerdictOf(check, 10)).toEqual({ kind: 'tempo' })
  })

  it('flags nothing that rounds to the tolerance itself, so a note never reads the very limit the user set', () => {
    expect(needsGridFix(checkOfAudit(auditOf(steady(10.4))), 10)).toBe(false)
  })

  it('follows the tolerance chosen in Settings', () => {
    const check = checkOfAudit(auditOf(steady(14)))
    expect(needsGridFix(check, 10)).toBe(true)
    expect(needsGridFix(check, 20)).toBe(false)
  })
})
