import { describe, expect, it } from 'vitest'
import { detectOnsets, detectTrim, refineOnset, trimThresholdDb } from './trim'

// 200 buckets over 100 s → 0.5 s per bucket, coarse but plenty for a suggestion
// the user refines with the handles.
function wave(fill: (sec: number) => number): { peaks: number[]; durationSec: number } {
  const peaks = Array.from({ length: 200 }, (_, i) => fill(i * 0.5))
  return { peaks, durationSec: 100 }
}

// Vinyl lead-in/run-out is never digital silence — the fixtures carry surface
// noise well below the -60 dB threshold where the suggestion must still fire.
const NOISE = 0.0005
const MUSIC = 0.3

describe('detectTrim', () => {
  it('suggests cutting a noisy head and tail, padded away from the music', () => {
    const trim = detectTrim(wave((sec) => (sec >= 10 && sec < 90 ? MUSIC : NOISE)))
    // Music starts at bucket 20 (10 s); the suggestion backs off by the pad so
    // the cut never bites the first transient the coarse buckets half-covered.
    expect(trim?.startSec).toBeGreaterThan(8.5)
    expect(trim?.startSec).toBeLessThan(10)
    expect(trim?.endSec).toBeGreaterThan(90)
    expect(trim?.endSec).toBeLessThan(91.5)
  })

  it('suggests only the noisy side', () => {
    const head = detectTrim(wave((sec) => (sec >= 10 ? MUSIC : NOISE)))
    expect(head?.startSec).toBeDefined()
    expect(head?.endSec).toBeUndefined()
    const tail = detectTrim(wave((sec) => (sec < 90 ? MUSIC : NOISE)))
    expect(tail?.startSec).toBeUndefined()
    expect(tail?.endSec).toBeDefined()
  })

  // A suggestion to shave a fraction of a second is noise, not help — the section
  // should read "nothing to trim" for a well-cut track.
  it('suggests nothing when the track starts and ends on music', () => {
    expect(detectTrim(wave(() => MUSIC))).toBeUndefined()
  })

  // All-silent decode (or a null envelope): there is no music to keep, so there is
  // nothing sane to suggest either.
  it('suggests nothing for an all-silent file', () => {
    expect(detectTrim(wave(() => NOISE))).toBeUndefined()
    expect(detectTrim({ peaks: [], durationSec: 0 })).toBeUndefined()
  })
})

describe('detectOnsets', () => {
  // The drag magnet's target: the unpadded edges of the music itself — the exact
  // "at the wave" spot the padded suggestion deliberately backs away from.
  it('returns the unpadded music edges', () => {
    const w = wave((sec) => (sec >= 10 && sec < 90 ? MUSIC : NOISE))
    expect(detectOnsets(w)).toEqual({ startSec: 10, endSec: 90 })
  })

  it('returns undefined for an all-silent decode', () => {
    expect(detectOnsets(wave(() => NOISE))).toBeUndefined()
  })
})

describe('refineOnset', () => {
  // The drag magnet's precision pass: the coarse 8192-bucket onset can sit tens of
  // milliseconds off the audible wave; the finely-bucketed window narrows it so the
  // snapped handle visibly touches the music.
  it('narrows a coarse onset to the fine bucket where the audio starts', () => {
    // 1 s window from 9.5 s, 1000 buckets (1 ms each), music from 10.234 s.
    const peaks = Array.from({ length: 1000 }, (_, i) => (i >= 734 ? MUSIC : NOISE))
    expect(refineOnset(peaks, 9.5, 1, 'start', -60)).toBeCloseTo(10.234)
  })

  it('narrows the end onset to where the audio dies', () => {
    const peaks = Array.from({ length: 1000 }, (_, i) => (i < 266 ? MUSIC : NOISE))
    expect(refineOnset(peaks, 90, 1, 'end', -60)).toBeCloseTo(90.266)
  })

  it('returns undefined when the window is silent, keeping the coarse estimate', () => {
    expect(
      refineOnset(
        Array.from({ length: 100 }, () => NOISE),
        9.5,
        1,
        'start',
        -60,
      ),
    ).toBeUndefined()
    expect(refineOnset([], 9.5, 1, 'start', -60)).toBeUndefined()
  })

  // The refine pass must judge its window with the track's own gate, not a fixed
  // one, or the magnet would snap to hiss the coarse suggestion already cut.
  it('applies the adaptive gate it is given', () => {
    const HISS = 0.005
    const peaks = Array.from({ length: 1000 }, (_, i) => (i >= 500 ? MUSIC : HISS))
    expect(refineOnset(peaks, 0, 1, 'start', -60)).toBeCloseTo(0)
    expect(refineOnset(peaks, 0, 1, 'start', -40)).toBeCloseTo(0.5)
  })
})

// The fixed -60 dB gate kept every lead-in whose noise sits ABOVE it: hiss, hum
// and room tone around -50 dB read as music and the suggestion stayed loose (a
// real user report). The gate now adapts to the track's own floor, measured off
// the same envelope, clamped so clean tracks behave exactly as before and quiet
// musical intros are never eaten. Anchors measured on real files 2026-09-03:
// clean floors -73..-87 dB (gate stays -60), a long fade grazing -61 at the very
// last bucket (protected by the half-second minimum), quiet intros at -35..-26
// (above the -40 cap).
describe('adaptive gate', () => {
  const HISS = 0.005

  it('cuts a hissy lead-in that the fixed -60 dB gate used to keep', () => {
    // 10 s of -46 dB hiss, then music: the old gate saw the hiss as music and
    // suggested nothing; the adaptive gate clears it and cuts at the real start.
    const trim = detectTrim(wave((sec) => (sec >= 10 ? MUSIC : HISS)))
    expect(trim?.startSec).toBeGreaterThan(8.5)
    expect(trim?.startSec).toBeLessThan(10)
  })

  it('leaves a quiet musical build alone: the gate never rises past -40 dB', () => {
    // A -34 dB intro over the same hiss: the cap keeps the gate below the intro,
    // so the cut lands where the hiss ends, not where the track gets loud.
    const BUILD = 0.02
    const trim = detectTrim(wave((sec) => (sec < 10 ? HISS : sec < 30 ? BUILD : MUSIC)))
    expect(trim?.startSec).toBeLessThan(10)
  })

  it('suggests nothing when the whole track sits under the gate', () => {
    expect(detectTrim(wave(() => HISS))).toBeUndefined()
  })

  it('computes the gate from the envelope floor, clamped to [-60, -40]', () => {
    const at = (db: number): number => 10 ** (db / 20)
    const floored = (db: number): number[] =>
      Array.from({ length: 200 }, (_, i) => (i < 20 ? at(db) : MUSIC))
    // A clean -87 dB floor stays on the old gate; a -46 dB hiss floor caps at
    // -40; a -55 dB floor lands at floor + margin.
    expect(trimThresholdDb(floored(-87))).toBe(-60)
    expect(trimThresholdDb(floored(-46))).toBe(-40)
    expect(trimThresholdDb(floored(-55))).toBeCloseTo(-43)
    // Digital zeros carry no floor information: the gate stays put.
    expect(trimThresholdDb(Array.from({ length: 200 }, () => 0))).toBe(-60)
    expect(trimThresholdDb([])).toBe(-60)
  })
})
