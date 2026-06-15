import { describe, expect, it } from 'vitest'
import { type Band, bandFrequencies, detectCutoff, fineBandFrequencies } from './cutoff'

// Per-band RMS (dB) measured from real signals at 44.1 kHz (Nyquist 22.05 kHz),
// band centres 9–21 kHz. These encode the distinction the detector exists to
// make: a lossless full-band spectrum tapers smoothly, a lossy re-encode drops
// off a cliff at the codec's lowpass — and a smooth taper with no cliff is NOT
// a cut, however far below Nyquist it ends.
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
// from a real file): a continuous rolloff whose steepest single step is 6.9 dB
// at 15→16 kHz and which keeps collapsing afterwards. A sustained knee, even a
// soft one, is a codec lowpass.
const SLOPED_CUT_15K = band([
  -34.28, -35.27, -36.27, -37.8, -41.15, -44.44, -48.91, -55.8, -59.27, -62.48, -65.95, -70.26,
  -76.95,
])
// Another real re-wrapped MP3, cut at ~16 kHz: its steepest step is 7.46 dB
// (16→17 kHz) and never recovers — the sustained-knee pass must catch it.
const SLOPED_CUT_16K = band([
  -29.72, -30.54, -31.49, -33.08, -34.58, -36.43, -38.95, -44.54, -52.0, -55.75, -59.26, -63.28,
  -68.99,
])
// A REAL lossless full-band track (measured) that rolls off steeply through the
// highs yet keeps energy all the way to Nyquist — only 24.9 dB down at 21 kHz.
// Its 9–16 kHz slope is indistinguishable from the cut files above; the only
// thing that says "good" is that the top band has NOT collapsed to the noise
// floor. Flagging it is the false positive this detector must avoid.
const REAL_FULL_BAND = band([
  -33.42, -35.08, -36.69, -39.24, -42.19, -44.74, -46.17, -48.66, -49.94, -53.38, -54.81, -58.46,
  -59.93,
])
// Real 320 kbps MP3 (measured): a smooth ~4 dB/band taper with no knee anywhere,
// still carrying energy at 21 kHz. The old fallback called this "cut at 16 kHz"
// because the slope crosses plateau−12 dB there — the false positive users
// reported most. Without a knee the honest reading is the energy extent: the
// last band still within 25 dB of the 9–11 kHz plateau (18 kHz here).
const SMOOTH_TAPER_320 = band([
  -32.9, -33.5, -34.8, -36.4, -37.4, -39.6, -43.5, -46.7, -51.0, -55.8, -59.3, -63.6, -68.7,
])
// Same profile from another real 320: slightly steeper but still knee-free.
const SMOOTH_TAPER_320_B = band([
  -34.1, -34.6, -35.9, -37.0, -39.0, -41.7, -45.4, -49.2, -53.3, -57.2, -61.0, -64.6, -69.0,
])
// Two real FLACs a user reported as wrongly graded "Review" (measured). Both are
// genuine dark masters: a smooth taper, steepest step ~4.6 dB (no knee), energy
// extent at 18 kHz, still falling monotonically to 21 kHz — not a codec cut.
const DARK_MASTER_FUCK = band([
  -32.8, -32.8, -34.3, -36.3, -39.3, -42.3, -45.6, -49.7, -54.3, -57.6, -60.4, -63.6, -67.4,
])
const DARK_MASTER_MAREAO = band([
  -35.9, -36.0, -36.7, -38.9, -41.3, -44.3, -47.3, -51.0, -54.5, -58.4, -62.2, -66.3, -70.7,
])
// Real ~190 kbps-class MP3s (measured): quiet ~2 dB/band taper, then a 7–8 dB
// step that keeps falling — the encoder's soft lowpass. These sit just under the
// old 8 dB wall threshold, so they were graded "Good"; the sustained-knee pass
// must place the cut at the knee.
const SOFT_KNEE_16K = band([
  -33.9, -34.1, -34.6, -36.1, -38.4, -39.0, -41.8, -44.3, -51.4, -57.2, -60.9, -64.5, -68.8,
])
const SOFT_KNEE_17K = band([
  -36.6, -36.5, -37.4, -38.6, -40.6, -42.6, -44.5, -46.9, -50.9, -58.7, -63.0, -66.9, -71.1,
])
// Real file run through a spectral "enhancer" (measured): the energy falls to a
// valley at 16 kHz then RISES 11.8 dB to peak at 19 kHz — louder than the 9 kHz
// reference. Natural spectra never climb back up there; regenerated highs over a
// low-bitrate source must not pass as full-band.
const SYNTHETIC_HUMP = band([
  -38.9, -39.9, -40.9, -42.2, -44.0, -45.7, -47.2, -48.6, -45.1, -39.5, -36.8, -40.3, -55.6,
])
// Real ~270 kbps VBR at 48 kHz (measured, bands reach 22 kHz): smooth taper with
// the encoder's lowpass showing as an 8 dB step at the very top. The cut is at
// 21 kHz — not at 16 kHz where the slope happens to cross plateau−12 dB.
const FREQS_48K = [...FREQS, 22000]
const VBR_48K = FREQS_48K.map((freqHz, i) => ({
  freqHz,
  rmsDb: [
    -34.7, -34.1, -36.0, -37.8, -40.0, -41.8, -44.4, -47.3, -48.6, -49.6, -51.0, -54.0, -59.8,
    -67.8,
  ][i],
}))

describe('detectCutoff', () => {
  it('reports Nyquist for full-band audio so it is not falsely flagged as cut', () => {
    expect(detectCutoff(FULL_BAND, NYQUIST)).toEqual({
      cutoffHz: NYQUIST,
      processed: false,
      hasKnee: false,
    })
  })

  it('locates a sharp lowpass shelf at the last band before the drop', () => {
    expect(detectCutoff(AAC_CUT_16K, NYQUIST).cutoffHz).toBe(16000)
    expect(detectCutoff(MP3_CUT_20K, NYQUIST).cutoffHz).toBe(20000)
  })

  it('catches a sloped lowpass whose rolloff never drops 8 dB in one step', () => {
    expect(detectCutoff(SLOPED_CUT_15K, NYQUIST).cutoffHz).toBe(15000)
    expect(detectCutoff(SLOPED_CUT_16K, NYQUIST).cutoffHz).toBe(16000)
  })

  it('places a soft encoder knee at the knee, not where the slope crosses a level', () => {
    // These were graded "Good" before: their 7–8 dB knees sit under the old 8 dB
    // wall threshold, and the fallback either missed them or invented an edge.
    expect(detectCutoff(SOFT_KNEE_16K, NYQUIST).cutoffHz).toBe(16000)
    expect(detectCutoff(SOFT_KNEE_17K, NYQUIST).cutoffHz).toBe(17000)
  })

  it('reports hasKnee only for a real codec lowpass, never for a knee-free taper', () => {
    // The verdict reads this to tell a lossy cut (a sustained knee) from a genuine
    // dark master (a smooth taper): every cut file trips the knee, every clean one
    // does not. Grading the extent of a knee-free taper on the codec scale is what
    // demoted healthy masters to "review".
    expect(detectCutoff(AAC_CUT_16K, NYQUIST).hasKnee).toBe(true)
    expect(detectCutoff(SLOPED_CUT_15K, NYQUIST).hasKnee).toBe(true)
    expect(detectCutoff(SOFT_KNEE_16K, NYQUIST).hasKnee).toBe(true)
    expect(detectCutoff(SMOOTH_TAPER_320, NYQUIST).hasKnee).toBe(false)
    expect(detectCutoff(FULL_BAND, NYQUIST).hasKnee).toBe(false)
    expect(detectCutoff(SYNTHETIC_HUMP, NYQUIST).hasKnee).toBe(false)
  })

  it('does not flag a full-band track that rolls off but reaches Nyquist', () => {
    expect(detectCutoff(REAL_FULL_BAND, NYQUIST)).toEqual({
      cutoffHz: NYQUIST,
      processed: false,
      hasKnee: false,
    })
  })

  it('reads a knee-free smooth taper as its energy extent, never an invented cut', () => {
    // The headline false positive: the old fallback reported "cut at 16 kHz" for
    // these healthy 320s because their natural slope crosses plateau−12 dB there.
    // With no knee there is no cut — only how far meaningful energy extends.
    expect(detectCutoff(SMOOTH_TAPER_320, NYQUIST)).toEqual({
      cutoffHz: 18000,
      processed: false,
      hasKnee: false,
    })
    expect(detectCutoff(SMOOTH_TAPER_320_B, NYQUIST)).toEqual({
      cutoffHz: 18000,
      processed: false,
      hasKnee: false,
    })
  })

  it('reads real user-reported dark masters as knee-free, not a lossy cut', () => {
    // Two real FLACs a user flagged as wrongly graded "Review" (Dj Lara & Neus —
    // Fuck; Alex Cervera — Mareao). Both taper smoothly with no knee anywhere
    // (steepest step ~4.6 dB), reach 18 kHz of meaningful energy and keep falling
    // monotonically to Nyquist: genuine dark masters, not 192 kbps sources.
    expect(detectCutoff(DARK_MASTER_FUCK, NYQUIST)).toEqual({
      cutoffHz: 18000,
      processed: false,
      hasKnee: false,
    })
    expect(detectCutoff(DARK_MASTER_MAREAO, NYQUIST)).toEqual({
      cutoffHz: 18000,
      processed: false,
      hasKnee: false,
    })
  })

  it('flags regenerated highs that rise where natural spectra only fall', () => {
    // The cut is reported at the valley — the original source's ceiling — so the
    // grade reflects what the audio really carries under the synthetic gloss.
    expect(detectCutoff(SYNTHETIC_HUMP, NYQUIST)).toEqual({
      cutoffHz: 16000,
      processed: true,
      hasKnee: false,
    })
  })

  it('finds the encoder lowpass at the top of a 48 kHz taper instead of mid-slope', () => {
    expect(detectCutoff(VBR_48K, 24000)).toEqual({
      cutoffHz: 21000,
      processed: false,
      hasKnee: true,
    })
  })

  it('reports Nyquist when there are too few bands to compare', () => {
    expect(detectCutoff([], NYQUIST)).toEqual({
      cutoffHz: NYQUIST,
      processed: false,
      hasKnee: false,
    })
    expect(detectCutoff([{ freqHz: 9000, rmsDb: -33 }], NYQUIST)).toEqual({
      cutoffHz: NYQUIST,
      processed: false,
      hasKnee: false,
    })
  })

  it('ignores a notch that recovers — only a sustained drop is a codec lowpass', () => {
    // A resonant dip can fall 8 dB in one band and bounce straight back; a codec
    // wall never recovers. Keying on the steepest step alone would call this a
    // 13 kHz cut on otherwise full-band audio.
    const NOTCH = band([
      -33.0, -33.6, -34.4, -35.1, -36.0, -44.5, -36.8, -38.0, -39.2, -40.6, -42.0, -44.8, -47.9,
    ])
    expect(detectCutoff(NOTCH, NYQUIST)).toEqual({
      cutoffHz: NYQUIST,
      processed: false,
      hasKnee: false,
    })
  })
})

// Fine 500 Hz bands (13–21 kHz) measured from the same real files. At this
// resolution genuine spectra still fall monotonically, but reconstructed highs
// (HE-AAC SBR, spectral-band enhancers) saw-tooth where their transposed
// patches meet — the only measurable trace of a source that fooled every
// coarse rule by tapering smoothly all the way to Nyquist.
const FINE_FREQS = [
  13000, 13500, 14000, 14500, 15000, 15500, 16000, 16500, 17000, 17500, 18000, 18500, 19000,
  19500, 20000, 20500, 21000,
]
const fine = (rms: number[]): Band[] => FINE_FREQS.map((freqHz, i) => ({ freqHz, rmsDb: rms[i] }))

// Real 16-bit WAV from an SBR-class source (measured): coarse bands taper
// smoothly to Nyquist with no knee and no hump — graded "Good" — yet the fine
// bands rise and fall by 1.7–2.3 dB above 16.5 kHz, and the real content ends
// at the first sharp fine drop (16.5→17 kHz, 4.9 dB).
const SBR_COARSE = band([
  -31.1, -30.9, -31.8, -32.4, -33.7, -35.6, -37.2, -39.4, -42.4, -46.6, -50.4, -53.0, -55.7,
])
const SBR_FINE = fine([
  -38.6, -38.5, -39.6, -40.1, -41.5, -42.4, -43.4, -45.2, -50.1, -50.1, -48.4, -54.6, -52.3,
  -56.8, -55.7, -58.3, -64.8,
])
// The same fine measurement on a genuine 320 (the SMOOTH_TAPER_320 file):
// perfectly monotone, zero roughness — the population the threshold must spare.
const SMOOTH_TAPER_320_FINE = fine([
  -41.7, -42.6, -44.1, -47.1, -48.4, -50.2, -52.4, -55.0, -58.1, -60.5, -62.3, -63.9, -66.1,
  -68.8, -71.3, -74.6, -77.6,
])

describe('detectCutoff fine-band roughness', () => {
  it('flags patched highs by their fine-band sawtooth and reports the real ceiling', () => {
    expect(detectCutoff(SBR_COARSE, NYQUIST, SBR_FINE)).toEqual({
      cutoffHz: 16500,
      processed: true,
      hasKnee: false,
    })
  })

  it('leaves a genuine smooth taper alone when its fine bands fall monotonically', () => {
    expect(detectCutoff(SMOOTH_TAPER_320, NYQUIST, SMOOTH_TAPER_320_FINE)).toEqual({
      cutoffHz: 18000,
      processed: false,
      hasKnee: false,
    })
  })

  it('ignores fine bands that failed to parse instead of reading -Infinity as jagged', () => {
    // A missing astats line maps to -Infinity; a -Inf → finite pair would read as
    // an infinite rise and flag every track the moment parsing hiccups.
    const broken = SBR_FINE.map((b, i) => (i % 2 === 0 ? { ...b, rmsDb: -Infinity } : b))
    expect(detectCutoff(SMOOTH_TAPER_320, NYQUIST, broken)).toEqual({
      cutoffHz: 18000,
      processed: false,
      hasKnee: false,
    })
  })

  it('behaves exactly as before when no fine bands are supplied', () => {
    expect(detectCutoff(SBR_COARSE, NYQUIST)).toEqual({
      cutoffHz: NYQUIST,
      processed: false,
      hasKnee: false,
    })
  })
})

describe('fineBandFrequencies', () => {
  it('spans 13 kHz to 21 kHz in 500 Hz steps at 44.1 kHz', () => {
    expect(fineBandFrequencies(22050)).toEqual(FINE_FREQS)
  })

  it('caps at 21 kHz for higher sample rates — the patch region is absolute', () => {
    expect(Math.max(...fineBandFrequencies(24000))).toBe(21000)
  })

  it('returns nothing when Nyquist sits below the patch region', () => {
    expect(fineBandFrequencies(8000)).toEqual([])
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
