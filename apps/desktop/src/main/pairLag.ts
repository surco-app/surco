import { fft } from './fft'

export const PAIR_RATE = 44100
export const PAIR_WINDOW_SECONDS = 60
export const PAIR_MIN_SECONDS = 10
export const PAIR_SILENT_RMS = 1e-6

// The lag (in samples, a[i] lines up with b[i + lag]) within one second either way that
// best matches the 5 s of a from `from`, by normalised cross-correlation at every sample.
// Done through the FFT: the direct sum is ~1e10 multiply-adds at this rate. Null when the
// window is silent, since silence lines up with anything.
export function bestLag(
  a: Float32Array,
  b: Float32Array,
  from: number,
  reach = PAIR_RATE,
  window = 5 * PAIR_RATE,
  eitherPolarity = false,
): number | null {
  const width = Math.min(a.length, from + window) - from
  const silent = width * PAIR_SILENT_RMS ** 2
  const span = width + 2 * reach
  let n = 1
  while (n < span) n <<= 1
  const wRe = new Float64Array(n)
  const wIm = new Float64Array(n)
  const sRe = new Float64Array(n)
  const sIm = new Float64Array(n)
  let windowEnergy = 0
  for (let i = 0; i < width; i++) {
    wRe[i] = a[from + i]
    windowEnergy += wRe[i] * wRe[i]
  }
  if (windowEnergy < silent) return null
  for (let k = 0; k < span; k++) {
    const j = from - reach + k
    if (j >= 0 && j < b.length) sRe[k] = b[j]
  }
  const energy = new Float64Array(span + 1)
  for (let k = 0; k < span; k++) energy[k + 1] = energy[k] + sRe[k] * sRe[k]
  fft(wRe, wIm)
  fft(sRe, sIm)
  for (let k = 0; k < n; k++) {
    const re = wRe[k] * sRe[k] + wIm[k] * sIm[k]
    const im = wRe[k] * sIm[k] - wIm[k] * sRe[k]
    sRe[k] = re
    sIm[k] = -im
  }
  fft(sRe, sIm)
  let best: number | null = null
  let bestScore = -Infinity
  for (let k = 0; k <= 2 * reach; k++) {
    const e = energy[k + width] - energy[k]
    if (e < silent) continue
    const score = (eitherPolarity ? Math.abs(sRe[k]) : sRe[k]) / Math.sqrt(e)
    if (score > bestScore) {
      bestScore = score
      best = k - reach
    }
  }
  return best
}

// The wider search behind PairFacts.versionCorrelation, at a tenth of the probe's rate (the
// bass that carries most of a track's energy survives it). The reach is bounded so the FFT is
// never longer than 2^19 points, the size of the probe's own; a gap past that reach (about
// 54 s) is not searched. Even so one search held the event loop 58 to 293 ms when measured on
// the main process, so it runs in the analysis worker.
export const VERSION_RATE = 4410
const VERSION_WINDOW_SECONDS = 10
const VERSION_FFT_MAX = 2 ** 19
export const VERSION_REACH_MAX_SECONDS = Math.floor(
  (VERSION_FFT_MAX - VERSION_WINDOW_SECONDS * VERSION_RATE) / 2 / VERSION_RATE,
)

// The |correlation| of two copies decoded at VERSION_RATE, lined up on the best lag within
// reachSec either way in either polarity and compared over a minute (from 30 s when a is long
// enough). Null when either is too short or silent, or they share too little audio.
export function versionMatch(pa: Float32Array, pb: Float32Array, reachSec: number): number | null {
  const minSamples = PAIR_MIN_SECONDS * VERSION_RATE
  if (pa.length < minSamples || pb.length < minSamples) return null
  const from = pa.length >= 90 * VERSION_RATE ? 30 * VERSION_RATE : 0
  const lag = bestLag(
    pa,
    pb,
    from,
    Math.round(reachSec * VERSION_RATE),
    VERSION_WINDOW_SECONDS * VERSION_RATE,
    true,
  )
  if (lag === null) return null
  const start = Math.max(from, -lag)
  const end = Math.min(from + PAIR_WINDOW_SECONDS * VERSION_RATE, pa.length, pb.length - lag)
  const n = end - start
  if (n < minSamples) return null
  let sa = 0
  let sb = 0
  let saa = 0
  let sbb = 0
  let sab = 0
  for (let i = start; i < end; i++) {
    const x = pa[i]
    const y = pb[i + lag]
    sa += x
    sb += y
    saa += x * x
    sbb += y * y
    sab += x * y
  }
  const silent = n * PAIR_SILENT_RMS ** 2
  if (saa < silent || sbb < silent) return null
  return Math.abs((n * sab - sa * sb) / Math.sqrt((n * saa - sa * sa) * (n * sbb - sb * sb)))
}
