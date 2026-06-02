import { describe, expect, it } from 'vitest'
import { type Band, bandFrequencies, detectCutoff } from './cutoff'

// Per-band RMS (dB) measured from real signals at 44.1 kHz (Nyquist 22.05 kHz),
// band centres 9–21 kHz. These encode the distinction the detector exists to
// make: a lossless full-band spectrum tapers smoothly, a lossy re-encode drops
// off a cliff at the codec's lowpass.
const NYQUIST = 22050
const FREQS = [
  9000, 10000, 11000, 12000, 13000, 14000, 15000, 16000, 17000, 18000, 19000, 20000, 21000,
]
const band = (rms: number[]): Band[] => FREQS.map((freqHz, i) => ({ freqHz, rmsDb: rms[i] }))

// Pink noise reaching Nyquist — the energy tapers gently (steepest step ~3 dB).
const FULL_BAND = band([
  -33.0, -33.6, -34.4, -35.1, -36.0, -37.0, -38.0, -38.9, -40.0, -41.4, -42.7, -45.0, -48.2,
])
// Pink noise → AAC @128k with a 16 kHz lowpass → WAV: a ~10 dB shelf at 16→17 kHz.
const AAC_CUT_16K = band([
  -33.3, -33.9, -34.7, -35.5, -36.3, -37.4, -38.3, -39.4, -49.7, -55.9, -60.4, -65.0, -71.7,
])
// Pink noise → MP3 @320k → WAV: a ~17 dB shelf at 20→21 kHz.
const MP3_CUT_20K = band([
  -33.0, -33.6, -34.4, -35.1, -36.0, -37.0, -38.0, -38.9, -40.0, -41.4, -42.8, -48.2, -65.4,
])

describe('detectCutoff', () => {
  it('reports Nyquist for full-band audio so it is not falsely flagged as cut', () => {
    // The whole point: a smooth taper toward Nyquist is NOT a cutoff. Reporting
    // anything below Nyquist here is the bug that marked clean 22 kHz tracks
    // "Suspicious".
    expect(detectCutoff(FULL_BAND, NYQUIST)).toBe(NYQUIST)
  })

  it('locates a sharp lowpass shelf at the last band before the drop', () => {
    expect(detectCutoff(AAC_CUT_16K, NYQUIST)).toBe(16000)
    expect(detectCutoff(MP3_CUT_20K, NYQUIST)).toBe(20000)
  })

  it('reports Nyquist when there are too few bands to compare', () => {
    expect(detectCutoff([], NYQUIST)).toBe(NYQUIST)
    expect(detectCutoff([{ freqHz: 9000, rmsDb: -33 }], NYQUIST)).toBe(NYQUIST)
  })
})

describe('bandFrequencies', () => {
  it('spans 9 kHz up to just under Nyquist in 1 kHz steps', () => {
    expect(bandFrequencies(22050)).toEqual(FREQS)
  })

  it('never probes above 22 kHz even when Nyquist is higher', () => {
    // A 96 kHz file has nothing lossy to find above 22 kHz; the natural taper
    // near its Nyquist must not be read as a wall.
    expect(Math.max(...bandFrequencies(48000))).toBe(22000)
  })

  it('returns nothing when Nyquist is below the probing range', () => {
    expect(bandFrequencies(8000)).toEqual([])
  })
})
