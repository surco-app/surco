import { describe, expect, it } from 'vitest'
import { countClicks, detectClicks } from './clickDetect'

const RATE = 44100

function sine(seconds: number, amplitude = 0.25, hz = 440): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE))
  for (let i = 0; i < out.length; i++) out[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / RATE)
  return out
}

function addClick(samples: Float32Array, atSec: number, amplitude = 0.9, width = 2): void {
  const at = Math.round(atSec * RATE)
  for (let i = 0; i < width; i++) samples[at + i] += amplitude
}

describe('countClicks', () => {
  it('counts each isolated impulse once, whatever its width', () => {
    const s = sine(4)
    addClick(s, 0.5, 0.9, 2)
    addClick(s, 1.5, 0.9, 9)
    addClick(s, 2.5, 0.9, 2)
    expect(countClicks(s, RATE)).toBe(3)
  })

  it('hears a soft click over a quiet passage', () => {
    const s = sine(2, 0.1)
    addClick(s, 1, 0.2, 2)
    expect(countClicks(s, RATE)).toBe(1)
  })

  it('reports clean audio as zero', () => {
    expect(countClicks(sine(4), RATE)).toBe(0)
  })

  it('does not mistake a musical transient for a click', () => {
    // A kick-like attack: sharp exponential onset, but wide — energy spread over
    // milliseconds, unlike a click's 1-9 samples. The isolation test must reject it.
    const s = sine(2, 0.1)
    const at = Math.round(1 * RATE)
    for (let i = 0; i < 900; i++)
      s[at + i] += 0.8 * Math.exp(-i / 180) * Math.sin((2 * Math.PI * 60 * i) / RATE)
    expect(countClicks(s, RATE)).toBe(0)
  })

  it('merges a burst of detections within the same click', () => {
    const s = sine(4)
    // Two impulses 2 ms apart: one physical click event, not two.
    addClick(s, 1, 0.9, 2)
    addClick(s, 1.002, 0.9, 2)
    expect(countClicks(s, RATE)).toBe(1)
  })
})

describe('detectClicks', () => {
  it('reports where each click sits, not just how many', () => {
    const s = sine(4)
    addClick(s, 0.5)
    addClick(s, 1.5)
    addClick(s, 2.5)
    const at = detectClicks(s, RATE)
    expect(at).toHaveLength(3)
    // Within a millisecond of the impulse: the marks have to land ON the click for
    // "jump to this click and listen" to put the playhead anywhere useful.
    expect(at[0]).toBeCloseTo(0.5, 3)
    expect(at[1]).toBeCloseTo(1.5, 3)
    expect(at[2]).toBeCloseTo(2.5, 3)
  })

  it('returns them in order', () => {
    const s = sine(4)
    addClick(s, 2.5)
    addClick(s, 0.5)
    addClick(s, 1.5)
    const at = detectClicks(s, RATE)
    expect(at).toEqual([...at].sort((a, b) => a - b))
  })

  it('gives one position for a merged burst', () => {
    const s = sine(4)
    addClick(s, 1, 0.9, 2)
    addClick(s, 1.002, 0.9, 2)
    expect(detectClicks(s, RATE)).toHaveLength(1)
  })

  it('finds nothing in clean audio', () => {
    expect(detectClicks(sine(4), RATE)).toEqual([])
  })

  // The counter and the marks must never drift onto different calibrations: the count
  // in the header pill and the marks on the wave describe the same clicks, and a user
  // who reads "3 clicks" and counts 5 marks has been lied to by one of them.
  it('agrees with the count it is derived from', () => {
    const cases = [sine(4), sine(2, 0.1), sine(4)]
    addClick(cases[0], 0.5)
    addClick(cases[0], 1.5)
    addClick(cases[1], 1, 0.2, 2)
    for (const s of cases) expect(detectClicks(s, RATE)).toHaveLength(countClicks(s, RATE))
  })
})
