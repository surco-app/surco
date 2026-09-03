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

// A hi-res file's image is not drawn to Nyquist: above ~22 kHz there is nothing to see, and
// spending 79% of the panel on it (192 kHz, Nyquist 96 kHz) squashed the music into the
// bottom fifth. The image is capped, so the axis must read against the cap the image was
// actually drawn to, not the file's Nyquist. Otherwise every kHz mark, the cutoff line and
// this readout point at a row holding a different frequency.
describe('freqAtFraction with a capped image', () => {
  it('reads the top edge as the cap, not Nyquist, on a hi-res file', () => {
    expect(freqAtFraction(0, 192000, 24000)).toBe(24000)
  })

  it('scales the middle against the cap', () => {
    expect(freqAtFraction(0.5, 192000, 24000)).toBe(12000)
  })

  // A 44.1 kHz file's Nyquist already sits below the cap, so nothing changes for it: the
  // image still runs to 22.05 kHz and so must the axis.
  it('falls back to Nyquist when it sits below the cap', () => {
    expect(freqAtFraction(0, 44100, 24000)).toBe(22050)
  })

  // Analyses cached before the cap existed were drawn to Nyquist, and must keep reading
  // that way rather than rescaling to a cap their image never used.
  it('uses Nyquist when no cap is given', () => {
    expect(freqAtFraction(0, 192000)).toBe(96000)
  })
})
