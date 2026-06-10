// Estimates the musical key of mono PCM: an FFT per frame folds spectral
// energy into the 12 pitch classes (a chromagram), the track-averaged chroma
// is correlated against the Krumhansl-Kessler major/minor profiles in all 12
// rotations, and the best of the 24 wins. Pure DSP in plain JS for the same
// reason as tempo.ts — no native binary to bundle and sign, and the algorithm
// unit-tests on synthesized chords. Accuracy is inherently below a dedicated
// analyzer (no tuning compensation, sines/voices can mislead it), which is
// exactly why the result is only ever surfaced as a suggestion the user
// confirms, never written unattended.

import type { KeyResult } from '../shared/types'

// ~0.74 s frames at the 11025 Hz analysis rate give 1.35 Hz bins — enough to
// separate adjacent semitones down to the A1 floor below.
const FRAME = 8192
const HOP = 4096

// Harmony lives in this span. Below A1 is kick/rumble territory that smears
// the chroma; above A6 the spectrum is mostly timbre and hiss, not chords.
const MIN_HZ = 55
const MAX_HZ = 1760

// Pearson correlation against the winning profile. Noise's flat chroma
// correlates near zero and even weakly tonal material stays well under this,
// while a real progression scores far above — below the line, suggesting
// nothing beats suggesting a key that would ruin a harmonic mix.
const MIN_CONFIDENCE = 0.6

// Krumhansl-Kessler tone profiles: perceived stability of each pitch class
// within a major / minor key, from probe-tone experiments. Rotating them
// through the 12 roots yields all 24 key templates.
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]

// Names follow the Mixed In Key display convention DJs see elsewhere
// (sharps/flats mixed, e.g. F# but Eb), indexed by pitch class from C.
const MAJOR_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']
const MINOR_NAMES = ['Cm', 'C#m', 'Dm', 'Ebm', 'Em', 'Fm', 'F#m', 'Gm', 'G#m', 'Am', 'Bbm', 'Bm']

// Camelot wheel positions indexed by pitch class: majors are the B ring
// (C=8B, a fifth up steps +1), minors the A ring (Am=8A).
const MAJOR_CAMELOT = ['8B', '3B', '10B', '5B', '12B', '7B', '2B', '9B', '4B', '11B', '6B', '1B']
const MINOR_CAMELOT = ['5A', '12A', '7A', '2A', '9A', '4A', '11A', '6A', '1A', '8A', '3A', '10A']

// In-place iterative radix-2 FFT (Cooley-Tukey). FRAME is a power of two by
// construction, and ~650 frames of 8192 run in well under a second.
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j], re[i]]
      ;[im[i], im[j]] = [im[j], im[i]]
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len
    const wRe = Math.cos(angle)
    const wIm = Math.sin(angle)
    for (let i = 0; i < n; i += len) {
      let curRe = 1
      let curIm = 0
      for (let j = 0; j < len / 2; j++) {
        const aRe = re[i + j]
        const aIm = im[i + j]
        const bRe = re[i + j + len / 2] * curRe - im[i + j + len / 2] * curIm
        const bIm = re[i + j + len / 2] * curIm + im[i + j + len / 2] * curRe
        re[i + j] = aRe + bRe
        im[i + j] = aIm + bIm
        re[i + j + len / 2] = aRe - bRe
        im[i + j + len / 2] = aIm - bIm
        const nextRe = curRe * wRe - curIm * wIm
        curIm = curRe * wIm + curIm * wRe
        curRe = nextRe
      }
    }
  }
}

function pearson(a: number[], b: number[]): number {
  const n = a.length
  let meanA = 0
  let meanB = 0
  for (let i = 0; i < n; i++) {
    meanA += a[i]
    meanB += b[i]
  }
  meanA /= n
  meanB /= n
  let cov = 0
  let varA = 0
  let varB = 0
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA
    const db = b[i] - meanB
    cov += da * db
    varA += da * da
    varB += db * db
  }
  const denom = Math.sqrt(varA * varB)
  return denom === 0 ? 0 : cov / denom
}

export function detectKey(samples: Float32Array, sampleRate: number): KeyResult | null {
  const frames = samples.length < FRAME ? 0 : Math.floor((samples.length - FRAME) / HOP) + 1
  // A couple of seconds can't average out one chord's bias toward its own
  // root; refuse rather than read a single triad as the whole track's key.
  if (frames < 4) return null

  const window = new Float64Array(FRAME)
  for (let i = 0; i < FRAME; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FRAME)

  const minBin = Math.max(1, Math.ceil((MIN_HZ * FRAME) / sampleRate))
  const maxBin = Math.min(FRAME / 2 - 1, Math.floor((MAX_HZ * FRAME) / sampleRate))
  // Bin → pitch class, resolved once: 12·log2(f/440) counts semitones from A4,
  // and +9 re-roots the scale at C.
  const binPitchClass = new Int8Array(maxBin + 1)
  for (let bin = minBin; bin <= maxBin; bin++) {
    const hz = (bin * sampleRate) / FRAME
    binPitchClass[bin] = ((Math.round(12 * Math.log2(hz / 440)) + 9) % 12 + 12) % 12
  }

  const chroma = new Array(12).fill(0)
  const re = new Float64Array(FRAME)
  const im = new Float64Array(FRAME)
  for (let f = 0; f < frames; f++) {
    const start = f * HOP
    for (let i = 0; i < FRAME; i++) {
      re[i] = samples[start + i] * window[i]
      im[i] = 0
    }
    fft(re, im)
    for (let bin = minBin; bin <= maxBin; bin++) {
      chroma[binPitchClass[bin]] += Math.sqrt(re[bin] * re[bin] + im[bin] * im[bin])
    }
  }

  if (chroma.every((v) => v === 0)) return null

  let best = { camelot: '', name: '', confidence: -Infinity }
  for (let root = 0; root < 12; root++) {
    const rotate = (profile: number[]): number[] =>
      profile.map((_, pc) => profile[(((pc - root) % 12) + 12) % 12])
    const major = pearson(chroma, rotate(MAJOR_PROFILE))
    if (major > best.confidence) {
      best = { camelot: MAJOR_CAMELOT[root], name: MAJOR_NAMES[root], confidence: major }
    }
    const minor = pearson(chroma, rotate(MINOR_PROFILE))
    if (minor > best.confidence) {
      best = { camelot: MINOR_CAMELOT[root], name: MINOR_NAMES[root], confidence: minor }
    }
  }

  if (best.confidence < MIN_CONFIDENCE) return null
  return best
}
