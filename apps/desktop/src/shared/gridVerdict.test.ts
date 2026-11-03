import { describe, expect, it } from 'vitest'
import { gridVerdictOf } from './gridVerdict'

const beatsOf = (bpm: number, from: number, minutes: number) =>
  Array.from(
    { length: Math.floor((minutes * 60000) / (60000 / bpm)) },
    (_, i) => from + (i * 60000) / bpm,
  )

const phasesAt = (firstMs: (ms: number) => number, minutes: number) =>
  Array.from({ length: Math.floor((minutes * 60) / 6.4) }, (_, i) => {
    const ms = 3200 + i * 6400
    return { ms, firstMs: firstMs(ms) }
  })

describe('gridVerdictOf', () => {
  it('passes a grid that sits on the beats, as rekordbox gets most of them', () => {
    const fit = { bpm: 150, firstMs: 0, phases: phasesAt(() => 2, 5) }
    expect(gridVerdictOf(beatsOf(150, 0, 5), fit)).toBeNull()
  })

  it('names a grid moved the same amount all along, like Snow On The Sahara at -92 ms', () => {
    const fit = { bpm: 150, firstMs: 0, phases: phasesAt(() => 92, 5) }
    expect(gridVerdictOf(beatsOf(150, 0, 5), fit)).toEqual({ kind: 'shifted', ms: -92 })
  })

  it('names a grid that opens up towards the end, like Execute Base at -7.5 ms a minute', () => {
    const fit = { bpm: 150, firstMs: 0, phases: phasesAt((ms) => (7.5 * ms) / 60000, 5) }
    const verdict = gridVerdictOf(beatsOf(150, 0, 5), fit)
    expect(verdict?.kind).toBe('drifting')
    expect(verdict && 'msPerMin' in verdict ? verdict.msPerMin : 0).toBeCloseTo(-7.5, 0)
  })

  it('leaves out the stretches where the detector locked half a beat away, which it does in many tracks', () => {
    const fit = {
      bpm: 150,
      firstMs: 0,
      phases: phasesAt((ms) => (ms > 200000 && ms < 230000 ? 200 : 1), 5),
    }
    expect(gridVerdictOf(beatsOf(150, 0, 5), fit)).toBeNull()
  })

  it('says nothing when the measure is too unsteady to trust, as in a track spliced in zones', () => {
    const fit = {
      bpm: 150,
      firstMs: 0,
      phases: phasesAt((ms) => (Math.floor(ms / 20000) % 2) * 40, 5),
    }
    expect(gridVerdictOf(beatsOf(150, 0, 5), fit)).toBeNull()
  })

  it('says nothing with too few stretches measured', () => {
    expect(
      gridVerdictOf(beatsOf(150, 0, 5), {
        bpm: 150,
        firstMs: 0,
        phases: phasesAt(() => 92, 0.3),
      }),
    ).toBeNull()
  })
})
