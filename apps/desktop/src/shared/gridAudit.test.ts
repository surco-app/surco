import { describe, expect, it } from 'vitest'
import { auditNear, checkOfAudit, type GridAudit, gridVerdictOf, needsGridFix } from './gridAudit'

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

const KICKS = Array.from({ length: 2000 }, (_, i) => i * PERIOD)
const judge = (audit: GridAudit) => checkOfAudit(audit, KICKS)
const nearest = (audit: GridAudit, ms: number) => auditNear(audit, KICKS, ms)

describe('checkOfAudit', () => {
  it('passes a grid whose hits all sit within the tolerance, so a good grid stays out of the filter', () => {
    const check = judge(auditOf(steady(4)))
    expect(needsGridFix(check, 10)).toBe(false)
  })

  it('flags a grid laid off the hit all along, with how far', () => {
    const check = judge(auditOf(steady(-22)))
    expect(needsGridFix(check, 10)).toBe(true)
    expect(gridVerdictOf(check, 10)).toEqual({ kind: 'shifted', ms: -22 })
  })

  it('flags a grid that drifts off the hit in part of the track, where cues there would miss', () => {
    const drift = Array.from({ length: 40 }, (_, i) => (i < 20 ? 0 : (i - 20) * 1.5))
    const check = judge(auditOf(drift))
    expect(needsGridFix(check, 10)).toBe(true)
    expect(gridVerdictOf(check, 10)?.kind).toBe('partial')
  })

  it('ignores a short stretch that jumps to another instrument, which is the music changing, not the grid', () => {
    const offsets = steady(1)
    offsets.splice(15, 5, 76, 76, 78, 76, 76)
    expect(needsGridFix(judge(auditOf(offsets)), 10)).toBe(false)
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
    expect(gridVerdictOf(judge(audit), 10)?.kind).toBe('partial')
  })

  it('follows a drift past a quarter beat, where the folded reading flips sign', () => {
    const drift = Array.from({ length: 40 }, (_, i) => {
      const ms = 60 + i * 2
      return ms > PERIOD / 4 ? ms - PERIOD / 2 : ms
    })
    const verdict = gridVerdictOf(judge(auditOf(drift)), 10)
    expect(verdict).toEqual({ kind: 'shifted', ms: expect.any(Number) })
    expect(verdict?.kind === 'shifted' && verdict.ms).toBeGreaterThan(90)
  })

  it('follows a drift past a quarter beat the other way too', () => {
    const drift = Array.from({ length: 40 }, (_, i) => {
      const ms = -60 - i * 2
      return ms < -PERIOD / 4 ? ms + PERIOD / 2 : ms
    })
    const verdict = gridVerdictOf(judge(auditOf(drift)), 10)
    expect(verdict?.kind === 'shifted' && verdict.ms).toBeLessThan(-90)
  })

  it('judges nothing where the beat cannot be heard, so an a cappella is never blamed on its grid', () => {
    const check = judge(auditOf(steady(40, 4), { total: 40, heardPerMinute: 2 }))
    expect(check.kind).toBe('unmeasured')
    expect(needsGridFix(check, 10)).toBe(false)
  })

  it('blames the grid tempo when the beat is clear to Surco but smears on the grid', () => {
    const check = judge(auditOf(steady(0, 4), { total: 40, heardPerMinute: 26 }))
    expect(needsGridFix(check, 10)).toBe(true)
    expect(gridVerdictOf(check, 10)).toEqual({ kind: 'tempo' })
  })

  it('flags nothing that rounds to the tolerance itself, so a note never reads the very limit the user set', () => {
    expect(needsGridFix(judge(auditOf(steady(10.4))), 10)).toBe(false)
  })

  it('follows the tolerance chosen in Settings', () => {
    const check = judge(auditOf(steady(14)))
    expect(needsGridFix(check, 10)).toBe(true)
    expect(needsGridFix(check, 20)).toBe(false)
  })
})

describe('a draft measured against the program grid', () => {
  it('reads a draft an earlier Auto left on the offbeat as half a beat off the program kicks, never as on the beat', () => {
    const draft = auditOf([])
    draft.windows = Array.from({ length: 40 }, (_, i) => ({
      ms: (i + 1) * STEP_MS + PERIOD / 2 - 10,
      offsetMs: 10,
    }))
    draft.total = 40
    const verdict = gridVerdictOf(judge(draft), 10)
    expect(verdict?.kind).toBe('shifted')
    expect(verdict?.kind === 'shifted' && Math.abs(verdict.ms)).toBeGreaterThan(PERIOD / 2 - 20)
  })
})

describe('auditNear', () => {
  it('tells where the grid sits against the hit heard nearest a moment, as the editor shows under the playhead', () => {
    const near = nearest(auditOf(steady(-12)), 10 * STEP_MS + 100)
    expect(near?.gridMs).toBeCloseTo(12, 6)
    expect(near?.hitMs).toBeCloseTo(10 * STEP_MS - 12, 6)
  })

  it('never reads a stretch where the music changed instrument, so a break shows no false warning', () => {
    const offsets = steady(1)
    offsets.splice(15, 5, 76, 76, 78, 76, 76)
    expect(nearest(auditOf(offsets), 17 * STEP_MS)?.gridMs).toBeCloseTo(-1, 6)
  })

  it('reads nothing where the beat cannot be heard', () => {
    expect(nearest(auditOf(steady(5, 3), { total: 40, heardPerMinute: 0 }), STEP_MS)).toBeNull()
  })
})
