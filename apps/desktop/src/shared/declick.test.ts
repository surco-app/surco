import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DECLICK,
  declickCacheSuffix,
  declickFilter,
  normalizeDeclick,
  sameDeclick,
} from './declick'

describe('declickFilter', () => {
  it('returns no filter when off, so a plain conversion stays untouched', () => {
    expect(declickFilter({ mode: 'off', noise: 'off' })).toBeNull()
  })

  // One intensity ladder, each step calibrated: gentle raises the detection
  // threshold (touches ~0.45% of a clean commercial track vs standard's 6.3%,
  // synthetic clicks still repair fully), standard is adeclick's own defaults, and
  // strong adds the minimal burst fusion that also repairs long pops. The two knobs
  // NOT on the ladder stay out for measured reasons: t below 2 and b above 4 both
  // explode the repair cost past realtime — the "hung conversion" reports, twice.
  it('maps each intensity step to its calibrated filter', () => {
    expect(declickFilter({ mode: 'soft', noise: 'off' })).toBe('adeclick=t=4')
    expect(declickFilter({ mode: 'standard', noise: 'off' })).toBe('adeclick')
    expect(declickFilter({ mode: 'strong', noise: 'off' })).toBe('adeclick=b=4')
  })
})

// The levels the user picked by ear on a real rip's breakdown (12/10): each step takes
// 2-3 dB more off the 8-16 kHz floor there (−3/−5/−7 dB) while the music loses 0.3 dB,
// and on a clean digital master all three leave the audio as it was — tn=1 tracks the
// track's own noise, so there is nothing to subtract when there is no noise.
//
// Every step also cuts the platter rumble: a fourth-order highpass at 20 Hz, measured on
// sines at −25 dB at 10 Hz and −49 dB at 5 Hz, where turntable rumble lives, but only
// −0.2 dB at 50 Hz, where a kick's fundamental sits (a 25 Hz corner already took 1.2 dB
// off real 40 Hz sub). It is the same complaint to the listener — noise the record adds —
// and costs nothing worth keeping a separate switch for.
describe('declickFilter noise', () => {
  it('maps each noise step to its calibrated reduction, rumble cut included', () => {
    expect(declickFilter({ mode: 'off', noise: 'soft' })).toBe(
      'highpass=f=20,highpass=f=20,afftdn=nr=10:nf=-62:tn=1',
    )
    expect(declickFilter({ mode: 'off', noise: 'medium' })).toBe(
      'highpass=f=20,highpass=f=20,afftdn=nr=18:nf=-60:tn=1',
    )
    expect(declickFilter({ mode: 'off', noise: 'strong' })).toBe(
      'highpass=f=20,highpass=f=20,afftdn=nr=26:nf=-58:tn=1',
    )
  })

  // The rumble cut leads, so the subsonic swing is gone before adeclick models the signal;
  // the denoiser trails, so neither the clicks nor that swing throw its noise estimate.
  it('cuts the rumble first and reduces the hiss last, around the click repair', () => {
    expect(declickFilter({ mode: 'strong', noise: 'medium' })).toBe(
      'highpass=f=20,highpass=f=20,adeclick=b=4,afftdn=nr=18:nf=-60:tn=1',
    )
  })
})

describe('normalizeDeclick', () => {
  it('returns the default for a missing value', () => {
    expect(normalizeDeclick(undefined)).toBe(DEFAULT_DECLICK)
  })

  it('keeps a valid stored mode, including the 0.49-0.50 values', () => {
    expect(normalizeDeclick('off')).toEqual({ mode: 'off', noise: 'off' })
    expect(normalizeDeclick('soft')).toEqual({ mode: 'soft', noise: 'off' })
    expect(normalizeDeclick('standard')).toEqual({ mode: 'standard', noise: 'off' })
    expect(normalizeDeclick('strong')).toEqual({ mode: 'strong', noise: 'off' })
  })

  // A dev build briefly stored {mode, sensitivity}; its mode survives, the extra
  // dial is gone (the ladder covers its one useful position as 'soft').
  it('reads the short-lived config-object shape down to its mode', () => {
    expect(normalizeDeclick({ mode: 'strong', sensitivity: 3 })).toEqual({
      mode: 'strong',
      noise: 'off',
    })
  })

  it('keeps a stored config as it was saved', () => {
    expect(normalizeDeclick({ mode: 'soft', noise: 'medium' })).toEqual({
      mode: 'soft',
      noise: 'medium',
    })
  })

  it('keeps a saved noise step and drops an unknown one', () => {
    expect(normalizeDeclick({ mode: 'off', noise: 'strong' }).noise).toBe('strong')
    expect(normalizeDeclick({ mode: 'off', noise: 'max' }).noise).toBe('off')
  })

  it('repairs an unrecognized value to the default', () => {
    expect(normalizeDeclick('bogus')).toBe(DEFAULT_DECLICK)
    expect(normalizeDeclick({ mode: 'bogus' })).toBe(DEFAULT_DECLICK)
    expect(normalizeDeclick(42)).toBe(DEFAULT_DECLICK)
  })
})

describe('sameDeclick', () => {
  // Staleness compares the applied config to the dialled one; a reference check would
  // call two identical settings different and bring the Update button back for nothing.
  it('compares by value, not by reference', () => {
    expect(sameDeclick({ mode: 'soft', noise: 'off' }, { mode: 'soft', noise: 'off' })).toBe(true)
    expect(sameDeclick({ mode: 'soft', noise: 'off' }, { mode: 'strong', noise: 'off' })).toBe(
      false,
    )
    expect(sameDeclick({ mode: 'soft', noise: 'off' }, { mode: 'soft', noise: 'soft' })).toBe(false)
  })
})

// The loudness measurement is cached per filter chain: two settings that change the audio
// differently must never share an entry, or a normalize would size its gain on audio the
// export no longer contains.
describe('declickCacheSuffix', () => {
  it('gives every distinct setting its own cache entry', () => {
    const suffixes = new Set<string>()
    for (const mode of ['soft', 'standard', 'strong'] as const)
      for (const noise of ['off', 'soft', 'medium', 'strong'] as const)
        suffixes.add(declickCacheSuffix({ mode, noise }))
    expect(suffixes.size).toBe(3 * 4)
  })

  // Entries measured before the noise ladder existed stay valid for the same audio.
  it('keeps the click-only entries named as before', () => {
    expect(declickCacheSuffix({ mode: 'standard', noise: 'off' })).toBe('-declick-standard')
  })
})
