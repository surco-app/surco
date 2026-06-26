import { describe, expect, it } from 'vitest'
import { freqAtFraction } from './spectrumAxis'

// The spectrogram's Y axis is linear in Hz from 0 (bottom) to Nyquist (top), the same
// mapping the fixed kHz marks and the cutoff line already use. The hover crosshair has to
// invert it: a fraction measured from the TOP of the image back to a frequency. Getting
// the direction right is the whole point — top must read as Nyquist, not as 0.
describe('freqAtFraction', () => {
  it('reads the top edge as Nyquist and the bottom as 0', () => {
    expect(freqAtFraction(0, 44100)).toBe(22050)
    expect(freqAtFraction(1, 44100)).toBe(0)
  })

  it('reads the middle as half of Nyquist', () => {
    expect(freqAtFraction(0.5, 44100)).toBe(11025)
  })

  // A cursor that strays just outside the image (sub-pixel rounding, a fast drag) must not
  // report a frequency above Nyquist or below 0 — the readout would otherwise show an
  // impossible "23.1 kHz" at the very top.
  it('clamps a fraction outside 0..1 to the axis ends', () => {
    expect(freqAtFraction(-0.2, 44100)).toBe(22050)
    expect(freqAtFraction(1.3, 44100)).toBe(0)
  })

  // An unknown sample rate means there is no axis to read; callers hide the crosshair
  // rather than draw a 0 Hz line.
  it('returns null when the sample rate is not positive', () => {
    expect(freqAtFraction(0.5, 0)).toBeNull()
  })
})
