import { describe, expect, it } from 'vitest'
import { countClicks } from './clickDetect'

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
    for (let i = 0; i < 900; i++) s[at + i] += 0.8 * Math.exp(-i / 180) * Math.sin((2 * Math.PI * 60 * i) / RATE)
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
