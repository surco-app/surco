import { describe, expect, it } from 'vitest'
import { traktorReplaceShift } from './replaceCueShift'
import { shiftCueStart } from './traktor4'

// shiftCueStart SUBTRACTS the shift. Reading only one of the two lines gets the sign backwards
// (memory of 09/09), so the sign is pinned by landing a concrete cue.
describe('traktorReplaceShift', () => {
  // The new master starts 1.5 s later, so a cue the DJ set at 10 s must sit at 11.5 s or every
  // hot cue lands 1.5 s early on the replacement.
  it('lands a Traktor cue set at 10 000 ms at 11 500 ms when the new master starts 1.5 s later', () => {
    const s = traktorReplaceShift({ moved: 1500 }, 0, 0)
    expect(shiftCueStart(0, 10000, s.shiftMs)).toBe(11500)
  })

  // Traktor draws a new MP3 later by its codec lead, so the cue has to follow it or it sits
  // early on the waveform.
  it('adds what Traktor draws ahead of a new MP3', () => {
    const s = traktorReplaceShift({ moved: 1500 }, 50, 0)
    expect(shiftCueStart(0, 10000, s.shiftMs)).toBe(11550)
  })

  // The DJ calibrated Traktor against their own ears; replacing a file must not undo it.
  it("keeps the DJ's own Traktor offset, as every conversion does", () => {
    const s = traktorReplaceShift({ moved: 1500 }, 0, -20)
    expect(shiftCueStart(0, 10000, s.shiftMs)).toBe(11480)
  })

  // Anti-goal: not even the DJ's own adjustment is applied over a doubtful measurement, so
  // the cues stay exactly where they were.
  it('leaves Traktor cues where they were when the shift could not be trusted', () => {
    expect(traktorReplaceShift({ unmoved: 'noMatch' }, 50, -20)).toEqual({ shiftMs: 0 })
  })
})
