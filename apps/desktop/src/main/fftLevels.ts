// 4096 at 44.1 kHz puts ~10.8 Hz in a bin, so even the 500 Hz fine bands span
// dozens of them. The same size Spek, AudioAuditor and AVIL all settled on.
const FFT_SIZE = 4096
const HOP = FFT_SIZE / 2
// Below this a window is silence or near it; its spectrum is the noise floor and
// would drag the average down for every band equally.
const SILENCE_RMS = 1e-4

export interface BandSpec {
  freqHz: number
  widthHz: number
}

// In-place iterative radix-2 Cooley-Tukey. The input is real, so the caller
// leaves `im` zeroed and reads only the first half of the output.
function transform(re: Float64Array, im: Float64Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      const tr = re[i]
      re[i] = re[j]
      re[j] = tr
      const ti = im[i]
      im[i] = im[j]
      im[j] = ti
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wr = Math.cos(ang)
    const wi = Math.sin(ang)
    const half = len / 2
    for (let i = 0; i < n; i += len) {
      let cr = 1
      let ci = 0
      for (let k = 0; k < half; k++) {
        const ur = re[i + k]
        const ui = im[i + k]
        const vr = re[i + k + half] * cr - im[i + k + half] * ci
        const vi = re[i + k + half] * ci + im[i + k + half] * cr
        re[i + k] = ur + vr
        im[i + k] = ui + vi
        re[i + k + half] = ur - vr
        im[i + k + half] = ui - vi
        const ncr = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = ncr
      }
    }
  }
}

function hannWindow(size: number): { window: Float64Array; power: number } {
  const window = new Float64Array(size)
  for (let i = 0; i < size; i++) window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)))
  let power = 0
  for (let i = 0; i < size; i++) power += window[i] * window[i]
  return { window, power: power / size }
}

// Turns accumulated per-bin power into one mean level per requested band.
// Exported for tests: the dB conversion is where a normalisation slip would hide.
export function bandLevels(
  power: Float64Array,
  frames: number,
  specs: BandSpec[],
  sampleRateHz: number,
  windowPower: number,
): Map<string, number> {
  const levels = new Map<string, number>()
  if (frames === 0) return levels
  const binHz = sampleRateHz / FFT_SIZE
  const lastBin = power.length - 1
  for (const { freqHz, widthHz } of specs) {
    const lo = Math.max(0, Math.round((freqHz - widthHz / 2) / binHz))
    const hi = Math.min(lastBin, Math.round((freqHz + widthHz / 2) / binHz))
    if (hi < lo) {
      levels.set(`${freqHz}x${widthHz}`, Number.NEGATIVE_INFINITY)
      continue
    }
    let sum = 0
    for (let bin = lo; bin <= hi; bin++) sum += power[bin]
    const mean = sum / (hi - lo + 1) / frames
    // ×2 folds in the negative-frequency half of a real signal; dividing by
    // FFT_SIZE² and the window's power puts the result on the same dBFS scale
    // ffmpeg's own RMS readings use, so thresholds stay comparable.
    const scaled = (mean * 2) / (FFT_SIZE * FFT_SIZE * windowPower)
    levels.set(`${freqHz}x${widthHz}`, 10 * Math.log10(scaled + Number.MIN_VALUE))
  }
  return levels
}

export function sliceLevels(
  slices: Uint8Array[],
  specs: BandSpec[],
  sampleRateHz: number,
): Map<string, number> {
  const { window, power: windowPower } = hannWindow(FFT_SIZE)
  const bins = FFT_SIZE / 2 + 1
  const acc = new Float64Array(bins)
  const re = new Float64Array(FFT_SIZE)
  const im = new Float64Array(FFT_SIZE)
  let frames = 0

  for (const slice of slices) {
    const view = new DataView(slice.buffer, slice.byteOffset, slice.byteLength)
    const samples = Math.floor(slice.byteLength / 4)
    for (let base = 0; base + FFT_SIZE <= samples; base += HOP) {
      let energy = 0
      for (let i = 0; i < FFT_SIZE; i++) {
        const v = view.getFloat32((base + i) * 4, true)
        re[i] = v * window[i]
        im[i] = 0
        energy += v * v
      }
      if (Math.sqrt(energy / FFT_SIZE) < SILENCE_RMS) continue
      transform(re, im)
      for (let bin = 0; bin < bins; bin++) acc[bin] += re[bin] * re[bin] + im[bin] * im[bin]
      frames++
    }
  }

  return bandLevels(acc, frames, specs, sampleRateHz, windowPower)
}
