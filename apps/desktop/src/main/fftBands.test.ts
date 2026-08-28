import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))

import { bandLevels, probeOffsets } from './fftBands'

const FFT_SIZE = 4096
const SAMPLE_RATE = 44100

// A power spectrum with one flat level across every bin, as a full-scale sine
// through the same normalisation the measurement uses would produce.
function flatSpectrum(perBin: number): Float64Array {
  return new Float64Array(FFT_SIZE / 2 + 1).fill(perBin)
}

describe('probeOffsets', () => {
  it('spreads the probes across the body, skipping intro and outro', () => {
    const offsets = probeOffsets(300)
    expect(offsets).toHaveLength(12)
    // Nothing in the first 5% or past 95%: fades and silence carry no spectrum
    // worth measuring, and a probe landing in them would only add noise.
    expect(offsets[0]).toBeGreaterThanOrEqual(15)
    expect(offsets[offsets.length - 1]).toBeLessThanOrEqual(285)
  })

  it('scales with the track so a short edit is sampled as evenly as a long mix', () => {
    const short = probeOffsets(30)
    const long = probeOffsets(600)
    expect(short[0]).toBeCloseTo(1.5, 1)
    expect(long[0]).toBeCloseTo(30, 1)
    expect(short).toHaveLength(long.length)
  })

  it('yields one usable offset for a duration it cannot spread over', () => {
    // Duration can arrive as 0 from a container without one; probing from the
    // start still measures something, where an empty list would measure nothing.
    expect(probeOffsets(0)).toEqual([0])
    expect(probeOffsets(Number.NaN)).toEqual([0])
  })
})

describe('bandLevels', () => {
  it('reads a flat spectrum as the same level in every band', () => {
    // The property the old bandpass probe failed: it reported flat white noise as
    // falling 11 dB by 21 kHz, which is what made a natural rolloff look like a
    // codec wall. Whatever the absolute value, every band must read alike.
    const specs = [9000, 13000, 17000, 21000].map((freqHz) => ({ freqHz, widthHz: 1000 }))
    const levels = bandLevels(flatSpectrum(1e6), 10, specs, SAMPLE_RATE, 0.375)
    const values = specs.map((s) => levels.get(`${s.freqHz}x${s.widthHz}`) as number)
    for (const v of values) expect(v).toBeCloseTo(values[0], 6)
  })

  it('tracks a level change decibel for decibel', () => {
    // The detector reads differences between bands, so a step in the signal has to
    // survive as the same step in the reading.
    const specs = [{ freqHz: 15000, widthHz: 1000 }]
    const loud = bandLevels(flatSpectrum(1e6), 4, specs, SAMPLE_RATE, 0.375)
    const quiet = bandLevels(flatSpectrum(1e5), 4, specs, SAMPLE_RATE, 0.375)
    const drop = (loud.get('15000x1000') as number) - (quiet.get('15000x1000') as number)
    expect(drop).toBeCloseTo(10, 6)
  })

  it('averages over frames so a longer sample does not read louder', () => {
    // Accumulated power grows with every frame; without dividing by the count, a
    // long track would measure hotter than a short one and shift every threshold.
    const specs = [{ freqHz: 15000, widthHz: 1000 }]
    const few = bandLevels(flatSpectrum(1e6), 4, specs, SAMPLE_RATE, 0.375)
    const many = bandLevels(flatSpectrum(4e6), 16, specs, SAMPLE_RATE, 0.375)
    expect(many.get('15000x1000')).toBeCloseTo(few.get('15000x1000') as number, 6)
  })

  it('reports nothing rather than a wrong level when no frame was measured', () => {
    // An all-silent probe leaves zero frames; dividing by that would yield NaN and
    // the detector would compare it against thresholds as if it were a reading.
    const specs = [{ freqHz: 15000, widthHz: 1000 }]
    expect(bandLevels(flatSpectrum(1e6), 0, specs, SAMPLE_RATE, 0.375).size).toBe(0)
  })

  it('never returns NaN for a silent band', () => {
    // log10(0) is -Infinity and would propagate into the verdict; the floor keeps
    // it a very negative number the knee rule can still compare.
    const specs = [{ freqHz: 15000, widthHz: 1000 }]
    const levels = bandLevels(new Float64Array(FFT_SIZE / 2 + 1), 8, specs, SAMPLE_RATE, 0.375)
    const value = levels.get('15000x1000') as number
    expect(Number.isNaN(value)).toBe(false)
    expect(value).toBeLessThan(-200)
  })

  it('maps each band to exactly the bins its own frequencies occupy', () => {
    // A band must read its own frequencies and no others: a shift in the bin maths
    // would move every reading and with it the reported cutoff. Energy placed just
    // inside each edge has to register, and energy just outside must not — which
    // pins both ends rather than only proving the band is roughly in the region.
    const binHz = SAMPLE_RATE / FFT_SIZE
    const specs = [{ freqHz: 15000, widthHz: 1000 }]
    const at = (hz: number): number => {
      const power = new Float64Array(FFT_SIZE / 2 + 1)
      power[Math.round(hz / binHz)] = 1e9
      return bandLevels(power, 1, specs, SAMPLE_RATE, 0.375).get('15000x1000') as number
    }
    const silent = at(1000)
    // Inside the band (14.5–15.5 kHz), including both edges.
    expect(at(14600)).toBeGreaterThan(silent + 100)
    expect(at(15000)).toBeGreaterThan(silent + 100)
    expect(at(15400)).toBeGreaterThan(silent + 100)
    // Outside it, on both sides.
    expect(at(14000)).toBe(silent)
    expect(at(16000)).toBe(silent)
  })
})
