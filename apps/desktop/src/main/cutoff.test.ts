import { describe, expect, it } from 'vitest'
import {
  type Band,
  bandFrequencies,
  detectCutoff,
  detectUpsample,
  fineBandFrequencies,
} from './cutoff'

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
// The soft-knee population, re-measured by FFT: real LAME/AAC encodes of a
// lossless source whose transition band is gentle rather than a brick wall. These
// replace fixtures measured through bandpass, which blunted the same knees to
// 6.9–7.5 dB — the probe's own rolloff eating the step. Measured honestly they are
// 11.8–23.9 dB, so the knee rule catches them with room to spare.
const SLOPED_CUT_17K = band([
  -52.5, -53.8, -54.4, -55.3, -55.5, -57.1, -58.1, -63.0, -69.7, -93.5, -93.6, -94.5, -93.4,
])
const SLOPED_CUT_18K = band([
  -52.3, -53.5, -54.1, -55.0, -55.2, -57.0, -57.9, -62.0, -65.9, -69.9, -81.6, -90.6, -91.1,
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
// A real AAC 192k encode (FFT-measured): the gentlest knee in the corpus at
// 16.6 dB, sitting high at 19 kHz where a natural taper is also steepest. This is
// the case that decides the threshold's upper bound — the softest encoder wall we
// must still catch.
const SOFT_KNEE_19K = band([
  -53.0, -54.1, -54.7, -55.5, -55.7, -57.5, -58.5, -61.9, -65.8, -69.3, -75.2, -91.8, -90.5,
])
// Real file run through a spectral "enhancer" (measured): the energy falls to a
// valley at 16 kHz then RISES 11.8 dB to peak at 19 kHz — louder than the 9 kHz
// reference. Natural spectra never climb back up there; regenerated highs over a
// low-bitrate source must not pass as full-band.
const SYNTHETIC_HUMP = band([
  -38.9, -39.9, -40.9, -42.2, -44.0, -45.7, -47.2, -48.6, -45.1, -39.5, -36.8, -40.3, -55.6,
])
// A real LAME VBR encode at 48 kHz (FFT-measured, bands reach 22 kHz). The file's
// own Nyquist is 24 kHz, so the encoder's lowpass at 18 kHz leaves four bands of
// collapsed spectrum above it — the cut must be read at the wall, not somewhere on
// the taper below it or at the top band where the energy merely runs out.
const FREQS_48K = [...FREQS, 22000]
const VBR_48K = FREQS_48K.map((freqHz, i) => ({
  freqHz,
  rmsDb: [
    -57.0, -57.5, -58.5, -61.7, -64.2, -67.0, -70.3, -76.9, -82.7, -88.2, -133.5, -133.7, -133.4,
    -133.6,
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

  it('catches a lowpass with a gentle transition band, not just a brick wall', () => {
    expect(detectCutoff(SLOPED_CUT_17K, NYQUIST).cutoffHz).toBe(17000)
    expect(detectCutoff(SLOPED_CUT_18K, NYQUIST).cutoffHz).toBe(18000)
  })

  it('places a soft encoder knee at the knee, not where the slope crosses a level', () => {
    // The softest wall in the corpus (16.6 dB) and the highest, at 19 kHz — where a
    // natural taper is steepest too, so it is the easiest one to mistake for one.
    expect(detectCutoff(SOFT_KNEE_19K, NYQUIST).cutoffHz).toBe(19000)
  })

  it('reports hasKnee only for a real codec lowpass, never for a knee-free taper', () => {
    // The verdict reads this to tell a lossy cut (a sustained knee) from a genuine
    // dark master (a smooth taper): every cut file trips the knee, every clean one
    // does not. Grading the extent of a knee-free taper on the codec scale is what
    // demoted healthy masters to "review".
    expect(detectCutoff(AAC_CUT_16K, NYQUIST).hasKnee).toBe(true)
    expect(detectCutoff(SLOPED_CUT_17K, NYQUIST).hasKnee).toBe(true)
    expect(detectCutoff(SOFT_KNEE_19K, NYQUIST).hasKnee).toBe(true)
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

  it('finds the encoder lowpass on a 48 kHz file, not the taper below it', () => {
    expect(detectCutoff(VBR_48K, 24000)).toEqual({
      cutoffHz: 18000,
      processed: false,
      hasKnee: true,
    })
  })

  // The bands only ever reach ~22 kHz (BAND_MAX_HZ), so on a 96 kHz file (Nyquist 48 kHz)
  // the detector never looked above 22 kHz. Reporting Nyquist there printed an absurd
  // "energy reaches ~48 kHz" that contradicted the "at the ~20 kHz line" caption and claimed
  // a reach Surco never measured. Full-band audio must read as the top of the PROBED range,
  // not Nyquist — honest about how far we actually looked. A native 44.1 kHz file is
  // unchanged: its Nyquist sits at the probed ceiling, so it still reads ~22 kHz.
  it('caps full-band high-rate audio at the probed ceiling, not Nyquist', () => {
    const r = detectCutoff(FULL_BAND, 48000)
    expect(r.hasKnee).toBe(false)
    expect(r.processed).toBe(false)
    // The energy reaches the last probed band, so the reading is the probed ceiling
    // (~22 kHz), never the file's 48 kHz Nyquist.
    expect(r.cutoffHz).toBeLessThanOrEqual(22050)
    expect(r.cutoffHz).toBeGreaterThanOrEqual(21000)
  })

  it('still reports a 44.1 kHz full-band track at its own Nyquist', () => {
    expect(detectCutoff(FULL_BAND, NYQUIST).cutoffHz).toBe(NYQUIST)
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
  13000, 13500, 14000, 14500, 15000, 15500, 16000, 16500, 17000, 17500, 18000, 18500, 19000, 19500,
  20000, 20500, 21000,
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
  -38.6, -38.5, -39.6, -40.1, -41.5, -42.4, -43.4, -45.2, -50.1, -50.1, -48.4, -54.6, -52.3, -56.8,
  -55.7, -58.3, -64.8,
])
// The same fine measurement on a genuine 320 (the SMOOTH_TAPER_320 file):
// perfectly monotone, zero roughness — the population the threshold must spare.
const SMOOTH_TAPER_320_FINE = fine([
  -41.7, -42.6, -44.1, -47.1, -48.4, -50.2, -52.4, -55.0, -58.1, -60.5, -62.3, -63.9, -66.1, -68.8,
  -71.3, -74.6, -77.6,
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

  it('does not read one spectral bump as a saw-tooth of patches', () => {
    // A real lossless master, coarse and fine bands measured off the same file. One
    // harmonic lifts the 17 kHz band 4.6 dB above its neighbour and nothing else
    // rises: a single feature, where an enhancer's patches meet in a run of teeth
    // (the SBR fixture rises three separate times). Summing rises let this one
    // bump clear the 3 dB bar, and a clean rip was reported as Reprocessed.
    const coarse = fftBand([
      -53.91, -55.6, -56.01, -57.89, -58.65, -59.53, -60.72, -60.28, -55.81, -61.33, -63.61,
      -64.49, -65.73,
    ])
    const oneBump = fine([
      -59.06, -59.06, -59.55, -60.24, -60.64, -60.37, -60.75, -59.38, -54.76, -57.21, -61.52,
      -63.07, -63.51, -64.39, -64.7, -64.43, -65.34,
    ])
    expect(detectCutoff(coarse, NYQUIST, oneBump).processed).toBe(false)
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

// Bands measured by FFT (the sampled pass in ffmpeg.ts), not by the old bandpass
// probe. One real lossless track, then the SAME track put through real encoders —
// so every row's right answer is known: the lossless one has no cut, each encode
// has its encoder's own lowpass. The old fixtures above were measured through
// bandpass+astats, whose IIR rolloff adds a phantom ~11 dB droop by 21 kHz; these
// carry no such bias, which is why the knee threshold they calibrate is higher.
const FFT_FREQS = [
  9000, 10000, 11000, 12000, 13000, 14000, 15000, 16000, 17000, 18000, 19000, 20000, 21000,
]
const fftBand = (rms: number[]): Band[] => FFT_FREQS.map((freqHz, i) => ({ freqHz, rmsDb: rms[i] }))

const FFT_LOSSLESS = fftBand([
  -57.5, -58.0, -59.0, -62.5, -64.8, -67.6, -71.2, -76.9, -81.0, -85.4, -89.5, -92.7, -92.8,
])
const FFT_MP3_320 = fftBand([
  -57.5, -58.1, -59.0, -62.5, -64.8, -67.6, -71.1, -77.1, -82.0, -87.4, -92.2, -104.5, -133.4,
])
const FFT_MP3_192 = fftBand([
  -57.6, -58.2, -59.1, -62.5, -64.9, -67.7, -70.9, -78.2, -85.0, -90.6, -103.7, -134.1, -133.5,
])
const FFT_MP3_128 = fftBand([
  -57.1, -57.5, -58.9, -62.2, -64.5, -67.7, -71.9, -80.0, -111.9, -133.5, -133.5, -134.1, -133.5,
])
const FFT_AAC_128 = fftBand([
  -57.4, -58.0, -58.8, -62.2, -64.6, -67.3, -70.4, -76.5, -83.0, -124.3, -127.7, -129.8, -131.4,
])
const FFT_MP3_96 = fftBand([
  -58.0, -58.3, -59.1, -62.3, -65.4, -69.2, -76.0, -130.6, -133.0, -133.4, -133.5, -134.1, -133.5,
])

describe('detectCutoff on FFT-measured bands', () => {
  it('finds each real encoder lowpass at the last band it passes', () => {
    // Measured against real LAME/AAC encodes of one lossless source, so the cut is
    // known by construction. Each lands within a band of the encoder's documented
    // lowpass (320k ~20.5k, 192k ~19k, 128k ~16k, 96k ~15k).
    expect(detectCutoff(FFT_MP3_320, NYQUIST).cutoffHz).toBe(20000)
    expect(detectCutoff(FFT_MP3_192, NYQUIST).cutoffHz).toBe(19000)
    expect(detectCutoff(FFT_MP3_128, NYQUIST).cutoffHz).toBe(16000)
    expect(detectCutoff(FFT_AAC_128, NYQUIST).cutoffHz).toBe(17000)
    expect(detectCutoff(FFT_MP3_96, NYQUIST).cutoffHz).toBe(15000)
  })

  it('reports every real encode as a knee and the lossless source as none', () => {
    // The verdict hangs on this flag, and these six rows are the same music: the
    // only difference is whether an encoder touched it.
    expect(detectCutoff(FFT_MP3_320, NYQUIST).hasKnee).toBe(true)
    expect(detectCutoff(FFT_MP3_192, NYQUIST).hasKnee).toBe(true)
    expect(detectCutoff(FFT_MP3_128, NYQUIST).hasKnee).toBe(true)
    expect(detectCutoff(FFT_AAC_128, NYQUIST).hasKnee).toBe(true)
    expect(detectCutoff(FFT_MP3_96, NYQUIST).hasKnee).toBe(true)
    expect(detectCutoff(FFT_LOSSLESS, NYQUIST).hasKnee).toBe(false)
  })

  it('does not invent a cut in the lossless source it was encoded from', () => {
    expect(detectCutoff(FFT_LOSSLESS, NYQUIST).hasKnee).toBe(false)
    expect(detectCutoff(FFT_LOSSLESS, NYQUIST).processed).toBe(false)
  })

  it('holds a steep natural rolloff into Nyquist to a stricter bar than a wall lower down', () => {
    // Where the two populations actually overlap is the top of the range: a natural
    // taper steepens as it runs into Nyquist, so the only lossless tracks that look
    // like walls do it at 20–21 kHz (measured 9.7 and 9.9 dB). Raising the bar
    // everywhere to exclude them would drop real 128/160k walls, which run as low as
    // 12 dB — so the top bands, and only those, answer to a higher threshold.
    const steepIntoNyquist = fftBand([
      -50.3, -51.6, -54.1, -53.5, -53.9, -55.3, -56.6, -58.2, -59.0, -59.7, -61.6, -66.8, -76.5,
    ])
    expect(detectCutoff(steepIntoNyquist, NYQUIST).hasKnee).toBe(false)
  })

  it('still catches a real encoder wall below the top bands at the ordinary bar', () => {
    // The counterweight to the rule above: this 128k wall drops only 12.3 dB, so a
    // threshold raised high enough to silence the Nyquist-edge false positives would
    // let a genuine fake through.
    const softWall128k = fftBand([
      -44.2, -45.1, -46.0, -47.3, -48.1, -49.6, -51.0, -54.4, -66.7, -70.1, -71.4, -72.0, -72.3,
    ])
    const verdict = detectCutoff(softWall128k, NYQUIST)
    expect(verdict.hasKnee).toBe(true)
    expect(verdict.cutoffHz).toBe(16000)
  })

  it('leaves headroom between a natural rolloff and a codec wall', () => {
    // The margin is the whole point of the threshold. Measured on FFT bands, real
    // encoder walls are 28-55 dB in one step, while a lossless track's steepest
    // natural step reached 9.95 dB across the calibration set (3 of 12 lossless
    // tracks exceeded 6 dB). A threshold inside that natural range flags genuine
    // masters as fakes, which is exactly what the 6 dB one did.
    const naturalRolloff = fftBand([
      -47.1, -48.0, -50.1, -51.8, -54.6, -55.4, -59.0, -61.7, -66.3, -69.6, -71.1, -73.3, -83.2,
    ])
    expect(detectCutoff(naturalRolloff, NYQUIST).hasKnee).toBe(false)
  })
})

// Three CD rips of the same Gowan track, measured by the sampled FFT pass. Two
// earlier pressings and a 2010 remaster of the same master: none of them was ever
// through an encoder. Reported by a user whose remaster alone came back flagged.
const FFT_GOWAN_QOBUZ = fftBand([
  -71.38, -72.51, -72.12, -73.55, -78.25, -79.6, -85.03, -90.75, -100.87, -102.4, -107.81, -113.9,
  -128.01,
])
const FFT_GOWAN_REISSUE = fftBand([
  -72.51, -73.58, -72.79, -74.04, -78.62, -79.66, -84.73, -91.0, -100.18, -102.43, -107.49, -113.28,
  -127.18,
])
const FFT_GOWAN_REMASTER = fftBand([
  -62.29, -63.39, -62.32, -63.13, -67.37, -68.64, -73.9, -79.12, -87.98, -89.44, -94.21, -99.23,
  -104.69,
])
// The same three files at 500 Hz, where the top end shows itself as hiss: the level
// climbs again every other band (-105.2 to -100.3, -108.4 to -105.1) instead of
// staying down the way a codec's stopband does.
const FINE_GOWAN_QOBUZ = fine([
  -78.04, -80.57, -81.61, -86.35, -90.27, -91.62, -93.72, -94.87, -105.18, -100.32, -108.38,
  -105.06, -111.19, -112.37, -114.22, -126.62, -128.03,
])
const FINE_GOWAN_REISSUE = fine([
  -77.6, -78.86, -79.76, -82.05, -86.02, -89.59, -92.62, -94.3, -103.31, -100.22, -106.8, -103.75,
  -108.72, -110.19, -113.94, -125.61, -127.25,
])
const FINE_GOWAN_REMASTER = fine([
  -66.81, -68.14, -68.86, -71.34, -75.28, -78.02, -80.33, -81.95, -87.91, -86.66, -90.8, -90.1,
  -94.04, -95.38, -98.17, -101.44, -104.13,
])

describe('detectCutoff on a spectrum whose top end is hiss, not content', () => {
  it('reads the same master the same way whether or not its rolloff is steep', () => {
    // The three rips carry the same content and the same 16 kHz step (10.1, 9.2 and
    // 8.9 dB). They differ only in how far the top band falls away: 14.1 and 13.9 dB
    // on the quiet pressings, 5.5 dB on the louder remaster, whose noise floor covers
    // the fade. Keying on the steepest coarse step let that difference alone decide
    // the verdict, so the remaster was called lossy and the other two clean.
    const qobuz = detectCutoff(FFT_GOWAN_QOBUZ, NYQUIST, FINE_GOWAN_QOBUZ)
    const reissue = detectCutoff(FFT_GOWAN_REISSUE, NYQUIST, FINE_GOWAN_REISSUE)
    const remaster = detectCutoff(FFT_GOWAN_REMASTER, NYQUIST, FINE_GOWAN_REMASTER)
    expect(qobuz.hasKnee).toBe(remaster.hasKnee)
    expect(reissue.hasKnee).toBe(remaster.hasKnee)
  })

  it('does not read the wander of a dithery top end as patched highs either', () => {
    // Withdrawing the knee sends these files on to the roughness pass, which reads
    // the same hiss: its rebounds (+4.9, +3.3 dB at -105 dB) summed past the 3 dB
    // saw-tooth bar and came back as "processed", a heavier charge than the one just
    // dropped. An enhancer's patches rise at -50 to -57 dB, never down there.
    expect(detectCutoff(FFT_GOWAN_QOBUZ, NYQUIST, FINE_GOWAN_QOBUZ).processed).toBe(false)
    expect(detectCutoff(FFT_GOWAN_REISSUE, NYQUIST, FINE_GOWAN_REISSUE).processed).toBe(false)
  })

  it('does not read a dithery top end as a codec lowpass', () => {
    // A lossy source collapses monotonically through its whole cut: the weakest of 36
    // real encodes falls 64.7 dB without once climbing back. These three manage 27.1,
    // 25.7 and 21.1 dB before the level rebounds, because what is up there is hiss.
    expect(detectCutoff(FFT_GOWAN_QOBUZ, NYQUIST, FINE_GOWAN_QOBUZ).hasKnee).toBe(false)
    expect(detectCutoff(FFT_GOWAN_REISSUE, NYQUIST, FINE_GOWAN_REISSUE).hasKnee).toBe(false)
    expect(detectCutoff(FFT_GOWAN_REMASTER, NYQUIST, FINE_GOWAN_REMASTER).hasKnee).toBe(false)
  })

  it('still trusts a coarse knee when there are no fine bands to check it against', () => {
    // Callers that measure only the coarse bands get the old behaviour: there is
    // nothing to confirm against, so the knee stands on its own.
    expect(detectCutoff(FFT_MP3_128, NYQUIST).hasKnee).toBe(true)
  })

  it('confirms a real encoder wall through the same fine bands', () => {
    // A real 128k encode, coarse and fine bands measured off the same file. Its fine
    // descent runs 87.7 dB unbroken (-56.6 through -144.3), so the confirmation the
    // Gowan rips fail is one this clears with room — the rule has to keep both sides.
    const coarse = fftBand([
      -50.83, -52.28, -54.44, -54.82, -56.59, -58.57, -60.49, -65.15, -84.95, -138.02, -137.95,
      -144.82, -138.99,
    ])
    const fineBands = fine([
      -56.6, -57.12, -59.07, -59.35, -61.01, -62.21, -65.44, -72.09, -111.63, -144.25, -135.41,
      -145.61, -136.88, -137.49, -145.3, -136.84, -143.02,
    ])
    const verdict = detectCutoff(coarse, NYQUIST, fineBands)
    expect(verdict.hasKnee).toBe(true)
    expect(verdict.cutoffHz).toBe(17000)
  })
})

describe('detectUpsample', () => {
  // RMS (dB) of the 21.5 kHz (below the wall) and 23.5 kHz (above it) probe bands,
  // measured on real and synthetic files. A genuine high-rate master tapers ~8 dB
  // across the wall; a 44.1→48/96 upsample collapses 15+ dB into the resampler's
  // stopband. The gap is wide enough that the 12 dB threshold keeps ~3 dB of margin.
  it('passes a genuine high-rate master that tapers smoothly across 22.05 kHz', () => {
    expect(detectUpsample(-47.6, -55.6)).toBe(false) // native 48 kHz pink noise (8.0 dB)
    expect(detectUpsample(-72.5, -81.4)).toBe(false) // real 48 kHz master, Poky Zombie (8.9 dB)
  })

  it('flags a 44.1→48/96 upsample by the energy collapse above the 22.05 kHz wall', () => {
    expect(detectUpsample(-51.2, -71.5)).toBe(true) // upsampled pink noise (20.3 dB)
    expect(detectUpsample(-79.5, -94.9)).toBe(true) // a real 44.1 master upsampled (15.4 dB)
  })

  it('does not flag a non-finite reading, where a parse hiccup is indistinguishable from silence', () => {
    // -Infinity means an unparsed band or true silence; either way, flagging it
    // would risk a false positive the moment ffmpeg drops a line — stay quiet.
    expect(detectUpsample(-50, Number.NEGATIVE_INFINITY)).toBe(false)
    expect(detectUpsample(Number.NEGATIVE_INFINITY, -90)).toBe(false)
  })
})

// Two masters of the same Gowan song, measured off the real files: a 2008 reissue and
// a 2010 remaster whose spectrum is the reissue's shifted up 8 dB, harmonic for
// harmonic. The reissue graded clean and the remaster came back "Reprocessed" at
// 14 kHz, because the absolute floor that keeps dither out of the saw-tooth count
// also kept the reissue's two high harmonics (17 and 19 kHz) out of it, while the
// louder remaster lifted the same two above the floor. Two bumps 2 kHz apart are a
// feature of the music; the enhancer the pass was calibrated on rises three times
// in a row. The verdict has to survive a level change: same shape, same answer.
describe('detectCutoff roughness is level-invariant', () => {
  const REISSUE_COARSE = fftBand([
    -66.24, -67.45, -67.97, -72, -72.63, -70.78, -74.09, -80.07, -74.68, -85.42, -84.31, -88.44,
    -100.57,
  ])
  const REISSUE_FINE = fine([
    -73.53, -75.95, -68.69, -73.38, -73.78, -79.03, -80.45, -77.11, -72.87, -84.04, -85.24, -85.82,
    -82.83, -87.59, -88.63, -91.87, -110.72,
  ])
  const REMASTER_COARSE = fftBand([
    -58.06, -59.22, -59.74, -63.48, -64.04, -62.43, -65.54, -71.59, -65.53, -76.88, -75.68, -79.69,
    -91.31,
  ])
  const REMASTER_FINE = fine([
    -64.89, -67.52, -60.36, -65.01, -65.08, -70.38, -72.01, -67.78, -63.78, -75.56, -76.65, -77.16,
    -74.25, -78.78, -80.04, -82.88, -100.6,
  ])

  it('leaves both masters of the same song unflagged', () => {
    expect(detectCutoff(REISSUE_COARSE, NYQUIST, REISSUE_FINE).processed).toBe(false)
    expect(detectCutoff(REMASTER_COARSE, NYQUIST, REMASTER_FINE).processed).toBe(false)
  })

  it('grades the reissue the same after lifting it clear of the dither floor', () => {
    const lift = (bands: Band[]): Band[] => bands.map((b) => ({ ...b, rmsDb: b.rmsDb + 20 }))
    expect(detectCutoff(lift(REISSUE_COARSE), NYQUIST, lift(REISSUE_FINE)).processed).toBe(false)
  })
})

// Two files out of a 6000-track lossless library swept through the verdict,
// measured off the real files and judged by shape: what the detector got wrong at
// scale. Both are digital productions that roll off 2-7 dB per fine band from
// 15 kHz down to -100 dB at Nyquist; summed, that descent is 45 and 38 dB, and
// reading the fine bands as a total (45 in one release, 38 in the next) flagged 64
// and then 161 such files as lossy. A codec wall is not a long slope, it is a cliff:
// tens of dB inside a kilohertz.
describe('detectCutoff over the library sweep', () => {
  const ALFREDO_COARSE = fftBand([
    -50.6, -51.1, -52.3, -55.1, -57.6, -60.9, -64.1, -67.4, -69.1, -73.2, -78.8, -87.2, -101.4,
  ])
  const ALFREDO_FINE = fine([
    -58.3, -57.8, -61, -63, -64.2, -65.7, -66.7, -67.7, -69.3, -71.3, -73.3, -76.1, -79.3, -83.3,
    -88.7, -95.2, -102.8,
  ])
  const BEN_COARSE = fftBand([
    -53.5, -54, -56, -58.3, -60.6, -63.1, -65.4, -69.4, -75, -80.8, -88.6, -95.4, -99.1,
  ])
  const BEN_FINE = fine([
    -60.8, -62.2, -63.1, -63.8, -66.2, -67.8, -68.6, -72.6, -75.2, -78.2, -80.5, -84.9, -88.6,
    -92.6, -96, -98.6, -98.9,
  ])
  it('does not read a mastering rolloff that reaches -100 dB as a codec wall', () => {
    expect(detectCutoff(ALFREDO_COARSE, NYQUIST, ALFREDO_FINE).hasKnee).toBe(false)
    expect(detectCutoff(BEN_COARSE, NYQUIST, BEN_FINE).hasKnee).toBe(false)
  })
})
