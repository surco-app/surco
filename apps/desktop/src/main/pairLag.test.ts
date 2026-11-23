import { describe, expect, it } from 'vitest'
import { bestLag, correlationAt, lagCorrelations, PAIR_RATE } from './pairLag'

function noise(seed: number, samples: number): Float32Array {
  let state = seed
  const out = new Float32Array(samples)
  for (let i = 0; i < samples; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    out[i] = state / 0x80000000 - 1
  }
  return out
}

describe('pairLag', () => {
  const a = noise(1, 20 * PAIR_RATE)

  // The sign of every shift measured in the replaced-track review comes from here: positive
  // means the second file sounds later, so a cue has to move later with it.
  it('says a copy delayed by 100 samples lines up 100 samples later', () => {
    const b = new Float32Array(a.length + 100)
    b.set(a, 100)
    expect(bestLag(a, b, 5 * PAIR_RATE)).toBe(100)
  })

  // A copy that starts inside the other one must read as negative, or a cue would move the
  // wrong way and land late instead of early.
  it('says a copy cut 100 samples short lines up 100 samples earlier', () => {
    expect(bestLag(a, a.subarray(100), 5 * PAIR_RATE)).toBe(-100)
  })

  // Silence lines up with anything, so reporting a lag there would move cues by nonsense.
  it('is null over a silent window', () => {
    expect(bestLag(new Float32Array(20 * PAIR_RATE), a, 5 * PAIR_RATE)).toBeNull()
  })

  // The same-master verdict depends on this gap: a copy must score near 1, a different
  // recording far below the 0.9 threshold.
  it('correlates a copy with itself at 1 and unrelated noise far below 0.9', () => {
    expect(correlationAt(a, 0, a, 0, 5 * PAIR_RATE)).toBeCloseTo(1, 6)
    expect(correlationAt(a, 0, noise(2, 20 * PAIR_RATE), 0, 5 * PAIR_RATE)).toBeLessThan(0.2)
  })

  // The replaced-track review refuses a shift when a second lag fits almost as well (looped
  // intros), so it needs the whole curve as correlations, not only the winner.
  it('gives the correlation at every lag, 1 at the true one and null over silence', () => {
    const b = new Float32Array(a.length + 100)
    b.set(a, 100)
    const curve = lagCorrelations(a, b, 5 * PAIR_RATE, 1000)
    expect(curve?.length).toBe(2001)
    expect(curve?.[1100]).toBeCloseTo(1, 4)
    expect(curve?.[1000]).toBeLessThan(0.2)
    expect(lagCorrelations(new Float32Array(20 * PAIR_RATE), a, 5 * PAIR_RATE, 1000)).toBeNull()
  })
})
