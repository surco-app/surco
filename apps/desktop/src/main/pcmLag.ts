import { fft } from './fft'

export const PAIR_RATE = 44100
export const PAIR_SILENT_RMS = 1e-6

// The lag (in samples, a[i] lines up with b[i + lag]) within one second either way that
// best matches the 5 s of a from `from`, by normalised cross-correlation at every sample.
// Done through the FFT: the direct sum is ~1e10 multiply-adds at this rate. Null when the
// window is silent, since silence lines up with anything.
export function bestLag(a: Float32Array, b: Float32Array, from: number, reach = PAIR_RATE): number | null {
  const width = Math.min(a.length, from + 5 * PAIR_RATE) - from
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
    const score = sRe[k] / Math.sqrt(e)
    if (score > bestScore) {
      bestScore = score
      best = k - reach
    }
  }
  return best
}

// Normalised correlation of b from bFrom against a from aFrom over `width` samples, without
// removing the mean. Null when either side has no energy, since nothing correlates with silence.
export function correlationAt(
  a: Float32Array,
  aFrom: number,
  b: Float32Array,
  bFrom: number,
  width: number,
): number | null {
  let xx = 0
  let yy = 0
  let xy = 0
  for (let i = 0; i < width; i++) {
    xx += a[aFrom + i] * a[aFrom + i]
    yy += b[bFrom + i] * b[bFrom + i]
    xy += a[aFrom + i] * b[bFrom + i]
  }
  if (xx === 0 || yy === 0) return null
  return xy / Math.sqrt(xx * yy)
}
