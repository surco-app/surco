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
// A low-bitrate MP3 with a soft transition band, re-wrapped as FLAC (measured
// from a real file): a continuous ~4.5 dB/band rolloff from ~12 kHz instead of a
// single cliff. No step reaches 8 dB (the steepest is 6.9 dB at 15→16 kHz), so
// the single-step pass misses it; the energy still collapses 13.6 dB below the
// 9–11 kHz plateau by 15 kHz, which the sloped-lowpass fallback must catch.
const SLOPED_CUT_15K = band([
  -34.28, -35.27, -36.27, -37.8, -41.15, -44.44, -48.91, -55.8, -59.27, -62.48, -65.95, -70.26,
  -76.95,
])
// Another real re-wrapped MP3, cut at ~16 kHz: its steepest step is 7.46 dB
// (16→17 kHz) — close enough to WALL_DROP_DB to prove the fallback, not a nudged
// threshold, is what catches a soft transition band that nearly qualifies.
const SLOPED_CUT_16K = band([
  -29.72, -30.54, -31.49, -33.08, -34.58, -36.43, -38.95, -44.54, -52.0, -55.75, -59.26, -63.28,
  -68.99,
])
// A REAL lossless full-band track (measured) that rolls off steeply through the
// highs yet keeps energy all the way to Nyquist — only 24.9 dB down at 21 kHz.
// Its 9–16 kHz slope is indistinguishable from the cut files above; the only
// thing that says "good" is that the top band has NOT collapsed to the noise
// floor. The fallback must not flag it (this is the false positive that an
// intermediate-rolloff test would wrongly catch).
const REAL_FULL_BAND = band([
  -33.42, -35.08, -36.69, -39.24, -42.19, -44.74, -46.17, -48.66, -49.94, -53.38, -54.81, -58.46,
  -59.93,
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

  it('catches a sloped lowpass whose rolloff never drops 8 dB in one step', () => {
    // The bug: a low-bitrate MP3 with a soft transition band tapers ~4.5 dB per
    // band, so no single step trips the shelf detector and the track was passed
    // off as full-band "Good quality". The fallback flags it where the energy
    // has fallen >12 dB below the 9–11 kHz plateau.
    expect(detectCutoff(SLOPED_CUT_15K, NYQUIST)).toBe(15000)
    expect(detectCutoff(SLOPED_CUT_16K, NYQUIST)).toBe(16000)
  })

  it('does not flag a full-band track that rolls off but reaches Nyquist', () => {
    // The hard case: this real lossless file tapers as steeply as a cut through
    // 9–16 kHz, so any intermediate-rolloff rule flags it. What saves it is that
    // its energy survives to the top band instead of collapsing to the floor —
    // exactly the "reaches Nyquist" distinction. Flagging this is the false
    // positive the fallback exists to avoid.
    expect(detectCutoff(REAL_FULL_BAND, NYQUIST)).toBe(NYQUIST)
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
