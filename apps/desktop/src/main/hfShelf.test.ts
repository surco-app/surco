import { describe, expect, it } from 'vitest'
import {
  BAND_START_HZ,
  BAND_WIDTH_HZ,
  bandEnergiesDb,
  detectFftKnee,
  detectFlatShelf,
} from './hfShelf'

// Real whole-track (4 min) band energies measured with the same Blackman-Harris
// Welch FFT the analyzer runs, in dBFS per 1 kHz band from 8 kHz to 21 kHz
// (14 values). The reprocessed pair carry a synthetic flat shelf grafted onto a
// rolled-off source; the genuine ones taper or stay bright. Captured from the
// library so the thresholds are pinned to measured spectra, not invented numbers.
const NYQUIST = 22050

// Klis Klas Corp - This: real content dies ~16 kHz, then a dead-flat shelf
// (53.x dB across 17-22 kHz) holds to Nyquist — added highs.
const KLIS = [68.1, 67.3, 67.0, 65.9, 64.2, 62.2, 60.2, 56.8, 54.2, 53.4, 53.1, 53.1, 53.0, 53.0]
// Alex & Giro - Konichiwa: same fingerprint, a touch deeper shelf.
const KONICHIWA = [
  70.3, 68.7, 66.6, 64.1, 61.9, 59.8, 58.0, 56.3, 53.5, 51.9, 51.2, 51.1, 51.1, 51.3,
]
// DJ DBC - Check Check This Out: genuine taper that keeps falling to the top.
const CHECK_CHECK = [
  75.2, 73.9, 72.7, 71.9, 70.3, 68.3, 65.6, 62.0, 61.6, 60.5, 59.5, 59.6, 59.0, 58.6,
]
// Lazzard - Save Me: the nearest genuine file, still clearly declining.
const LAZZARD = [70.8, 68.6, 68.4, 66.7, 65.8, 64.7, 64.1, 61.4, 59.7, 58.8, 58.1, 57.2, 56.7, 56.3]
// DJ Misjah - The Professional: genuine dark master, deep continuous taper.
const MISJAH = [75.6, 73.3, 73.1, 69.9, 67.4, 63.3, 59.7, 54.9, 50.2, 47.6, 46.6, 45.8, 45.3, 45.2]
// Yulbox - The Week Is Over: genuinely bright master, HF rises back near plateau.
const YULBOX = [79.6, 77.8, 77.4, 75.7, 74.5, 71.7, 69.7, 65.7, 66.4, 70.9, 73.0, 72.5, 74.5, 72.3]

describe('detectFlatShelf', () => {
  it('flags a dead-flat synthetic shelf held to Nyquist and points the cutoff at the real ceiling', () => {
    // Klis' real content ends ~16 kHz: the cutoff names that ceiling, not the
    // shelf reaching Nyquist, so the dashed line and "reprocessed" verdict agree.
    expect(detectFlatShelf(KLIS, BAND_START_HZ, BAND_WIDTH_HZ, NYQUIST)).toBe(16000)
  })

  it('flags a deeper synthetic shelf', () => {
    expect(detectFlatShelf(KONICHIWA, BAND_START_HZ, BAND_WIDTH_HZ, NYQUIST)).toBe(17000)
  })

  it('leaves a genuine taper that keeps falling to the top alone', () => {
    expect(detectFlatShelf(CHECK_CHECK, BAND_START_HZ, BAND_WIDTH_HZ, NYQUIST)).toBeNull()
  })

  it('leaves the nearest-genuine gently-rolled-off master alone', () => {
    expect(detectFlatShelf(LAZZARD, BAND_START_HZ, BAND_WIDTH_HZ, NYQUIST)).toBeNull()
  })

  it('leaves a deep dark taper alone — a deep flat floor is a roll-off, not added highs', () => {
    expect(detectFlatShelf(MISJAH, BAND_START_HZ, BAND_WIDTH_HZ, NYQUIST)).toBeNull()
  })

  it('leaves a genuinely bright master alone — strong real highs near the plateau', () => {
    expect(detectFlatShelf(YULBOX, BAND_START_HZ, BAND_WIDTH_HZ, NYQUIST)).toBeNull()
  })

  it('does not flag a full-band flat spectrum (white-noise-like): flat but not detached', () => {
    const flat = new Array(14).fill(-30)
    expect(detectFlatShelf(flat, BAND_START_HZ, BAND_WIDTH_HZ, NYQUIST)).toBeNull()
  })

  it('does not flag a deep flat noise floor above a hard cut (handled as a codec knee elsewhere)', () => {
    // Plateau at 0, then a flat floor 40 dB down: too deep to be added musical
    // highs — flagging it as "reprocessed" would mislabel an ordinary lossy cut.
    const cut = [0, -1, -2, -10, -20, -35, -42, -42, -42, -42, -42, -42, -42, -42]
    expect(detectFlatShelf(cut, BAND_START_HZ, BAND_WIDTH_HZ, NYQUIST)).toBeNull()
  })

  it('does not flag silence (every band equal at the floor, no detachment)', () => {
    const silence = new Array(14).fill(-120)
    expect(detectFlatShelf(silence, BAND_START_HZ, BAND_WIDTH_HZ, NYQUIST)).toBeNull()
  })
})

describe('bandEnergiesDb', () => {
  const SR = 44100
  function tone(freqHz: number, seconds: number): Float32Array {
    const n = Math.floor(SR * seconds)
    const out = new Float32Array(n)
    for (let i = 0; i < n; i++) out[i] = 0.5 * Math.sin((2 * Math.PI * freqHz * i) / SR)
    return out
  }

  it('puts a high tone in its own 1 kHz band and starts at 8 kHz', () => {
    const bands = bandEnergiesDb(tone(18500, 6), SR)
    expect(bands.length).toBe(14) // 8..21 kHz starts
    const peak = bands.indexOf(Math.max(...bands))
    // 18.5 kHz falls in the [18000, 19000) band → index 10 from an 8 kHz start.
    expect(BAND_START_HZ + peak * BAND_WIDTH_HZ).toBe(18000)
  })

  it('locates a lower tone in the correct band', () => {
    const bands = bandEnergiesDb(tone(9500, 6), SR)
    const peak = bands.indexOf(Math.max(...bands))
    expect(BAND_START_HZ + peak * BAND_WIDTH_HZ).toBe(9000)
  })
})

describe('detectFftKnee', () => {
  // Johann Gielen - Dreamchild: a ~128–160 kbps MP3 re-wrapped as FLAC, brick-walled
  // at ~16.5 kHz. The biquad-bandpass cutoff pass smears the wall to a 5.4 dB step —
  // under its 6 dB knee — so it reads "knee-free" and the verdict grades it "Good".
  // On the flat FFT bands the same wall is a single-band cliff: 58.6 → 48.2 dB
  // (10.4 dB) at 15→16 kHz that never recovers. This is the false negative the FFT
  // knee exists to catch. Measured whole-track, same Welch FFT as the others above.
  const DREAMCHILD = [
    70.4, 70.8, 68.9, 67.4, 65.6, 63.1, 60.4, 58.6, 48.2, 48.6, 44.2, 41.5, 36.6, 30.0,
  ]

  // Harold Heath - Can You Feel (Grant Dell & Bob Rosa Remix): a fake 320 whose real
  // content walls off ~16 kHz, but sparse HF transient spikes punch up to 19 kHz and
  // inflate the 17–19 kHz whole-file averages, so the wall reads as a gentle creep
  // (6/1.4/6.8 dB steps) rather than a single cliff. The energy only collapses into
  // the floor at the very top: 19→20 kHz = 25.9 dB, 20→21 kHz = 33.8 dB. Those two
  // cliffs are catastrophic — far steeper than any natural roll-off into Nyquist
  // (measured ≤14 dB on dark masters) — but they sit at the top edge with <2 bands
  // above, so the natural-roll-off guard used to spare them and the file graded "Good".
  const HAROLD = [
    70.6, 70.8, 68.4, 68.0, 66.7, 65.8, 62.7, 60.1, 57.4, 51.5, 50.0, 43.2, 17.3, -16.5,
  ]

  it('catches a codec wall the biquad pass smears below its knee threshold', () => {
    // The cutoff is the last full band before the cliff (the biquad pass reports the
    // same way) — enough for the verdict to grade it "Bad" instead of "Good".
    expect(detectFftKnee(DREAMCHILD, BAND_START_HZ, BAND_WIDTH_HZ)).toBe(15000)
  })

  it('catches a top-edge collapse spikes papered into a creep — a fake 320', () => {
    // The natural-roll-off guard needs ≥2 bands above a cliff so a steep final step
    // toward Nyquist is not read as a wall. But a 26+ dB collapse into the floor is
    // never a taper, so a catastrophic drop trips the knee even at the top edge.
    expect(detectFftKnee(HAROLD, BAND_START_HZ, BAND_WIDTH_HZ)).not.toBeNull()
  })

  it('leaves genuine masters alone — no single-band cliff to mistake for a wall', () => {
    // The real-file negatives the flat-shelf detector also spares: their steepest FFT
    // step is 2.7–4.8 dB (MISJAH, a dark master, is the worst at 4.8), well under the
    // 8 dB the knee demands. Flagging any of these is the false positive to avoid.
    for (const genuine of [CHECK_CHECK, LAZZARD, MISJAH, YULBOX]) {
      expect(detectFftKnee(genuine, BAND_START_HZ, BAND_WIDTH_HZ)).toBeNull()
    }
  })

  it('does not read the natural roll-off into Nyquist as a wall', () => {
    // A smooth taper whose only steep step is the final band (a real spectrum falling
    // toward Nyquist) has no collapsed plateau above it, so it is not a codec wall.
    const taper = [70, 68, 66, 64, 62, 60, 58, 56, 54, 52, 50, 48, 46, 36]
    expect(detectFftKnee(taper, BAND_START_HZ, BAND_WIDTH_HZ)).toBeNull()
  })

  it('does not read a steep but genuine dark roll-off at the top edge as a wall', () => {
    // A dark master can shed 12–14 dB across its last two bands as it falls into
    // Nyquist. That is a real taper, not a codec collapse — the top-edge exception
    // only fires on a catastrophic (≥20 dB) drop, so this stays clean.
    const darkTaper = [72, 70, 68, 66, 64, 61, 58, 54, 50, 46, 42, 38, 29, 17]
    expect(detectFftKnee(darkTaper, BAND_START_HZ, BAND_WIDTH_HZ)).toBeNull()
  })

  it('ignores a sharp drop that recovers — a notch, not a sustained codec wall', () => {
    const notch = [70, 69, 68, 67, 66, 65, 64, 52, 63, 62, 61, 60, 59, 58]
    expect(detectFftKnee(notch, BAND_START_HZ, BAND_WIDTH_HZ)).toBeNull()
  })
})
