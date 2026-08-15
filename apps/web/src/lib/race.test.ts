import { describe, expect, it } from 'vitest'
import { MANUAL_STEPS, RACE_END, raceFrame, SURCO_TOTAL, TRACKS } from './race'

describe('raceFrame', () => {
  // The whole claim of the section: the same 40 tracks, one job finishing while the
  // other has barely started. If both sides finished together the comparison would
  // be making no point at all.
  it('finishes Surco while the manual flow is still working', () => {
    const mid = raceFrame(RACE_END * 0.5)
    expect(mid.surcoDone).toBe(TRACKS)
    expect(mid.manualDone).toBeLessThan(TRACKS)
  })

  it('starts with nothing done and ends with both sides complete', () => {
    const start = raceFrame(0)
    expect(start.manualDone).toBe(0)
    expect(start.surcoDone).toBe(0)

    const end = raceFrame(RACE_END)
    expect(end.manualDone).toBe(TRACKS)
    expect(end.surcoDone).toBe(TRACKS)
  })

  // Batch steps happen once for the whole folder. Counting them per track is what
  // inflated an earlier version of this section to three hours — a number any DJ
  // who has done the work would know was wrong, which costs the credibility the
  // measured Surco figure needs.
  it('counts the batch steps once, not once per track', () => {
    const perTrack = MANUAL_STEPS.filter((s) => s.per === 'track')
    const batch = MANUAL_STEPS.filter((s) => s.per === 'batch')
    const repeating = perTrack.reduce((sum, s) => sum + s.seconds, 0)
    const once = batch.reduce((sum, s) => sum + s.seconds, 0)

    expect(batch.length).toBeGreaterThan(0)
    expect(raceFrame(RACE_END).manualSeconds).toBe(repeating * TRACKS + once)
  })

  // Surco's own number, measured: 40 tracks converted and tagged in ~7s.
  it('reports the measured Surco total when the run completes', () => {
    expect(raceFrame(RACE_END).surcoSeconds).toBeCloseTo(SURCO_TOTAL, 1)
  })

  // render(t) has to be a pure function of t: it's what makes replay, the final
  // frame and the reduced-motion jump all the same code path.
  it('is a pure function of t', () => {
    const a = raceFrame(RACE_END * 0.3)
    const b = raceFrame(RACE_END * 0.3)
    expect(a).toEqual(b)
  })

  // The reduced-motion path renders the end frame directly instead of animating,
  // so it must never read as a job left half-done.
  it('clamps past the end instead of overshooting', () => {
    // 3.7x rather than a whole multiple: an unclamped t would land mid-cycle and
    // report a job part-done, which a round multiple hides because the modulo
    // happens to come back to the same place.
    const past = raceFrame(RACE_END * 3.7)
    const end = raceFrame(RACE_END)
    expect(past.manualDone).toBe(TRACKS)
    expect(past.surcoDone).toBe(TRACKS)
    expect(past.manualSeconds).toBe(end.manualSeconds)
    expect(past.doneSteps).toEqual(end.doneSteps)
    expect(past.activeStep).toBeNull()
  })

  it('never runs the clock backwards', () => {
    let prev = -1
    for (let i = 0; i <= 20; i++) {
      const { manualSeconds } = raceFrame((RACE_END * i) / 20)
      expect(manualSeconds).toBeGreaterThanOrEqual(prev)
      prev = manualSeconds
    }
  })

  // One step is highlighted at a time so the eye can follow which tool the manual
  // flow is stuck in; the batch steps never take that highlight because they aren't
  // part of the per-track loop.
  it('highlights only per-track steps', () => {
    for (let i = 1; i < 20; i++) {
      const { activeStep } = raceFrame((RACE_END * i) / 40)
      if (activeStep !== null) {
        expect(MANUAL_STEPS[activeStep].per).toBe('track')
      }
    }
  })
})
