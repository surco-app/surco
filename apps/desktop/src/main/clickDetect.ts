// Estimates how many audible clicks a track carries — the RX-style counter shown in
// the editor's click-repair section, computed by Surco's own detector rather than
// adeclick (whose stderr reports touched samples, not events, and whose detector
// flags 6-10% of any dense mix).
//
// Method: the second difference |x[n] − 2x[n−1] + x[n−2]| spikes hard on an
// impulse, a candidate is a spike far above its block's average (K), and a
// candidate only counts when its immediate surroundings are calm (ISO) — a click
// is 1-9 samples wide, a musical transient (kick attack, snare) elevates the whole
// neighborhood. Calibrated empirically: synthetic 2- and 9-sample clicks over sine
// count exactly, 20 s excerpts of two clean commercial tracks count zero, clicks
// buried under loud dense passages are partially missed (≈masked to the ear too),
// which is why the UI words this as an *audible clicks* estimate.
const BLOCK = 4096
const K = 16
const ISO = 2
// Merge detections closer than 5 ms: one physical click, one count.
const MIN_GAP_SEC = 0.005
// Absolute floor so digital silence (or near it) can't turn the relative threshold
// into a hair trigger.
const FLOOR = 0.004
// How far the isolation window reaches around a candidate, and the half-width of
// the candidate itself excluded from it.
const ISO_REACH = 80
const ISO_SKIP = 6

export function countClicks(samples: Float32Array, sampleRate: number): number {
  const minGap = Math.round(MIN_GAP_SEC * sampleRate)
  const d = new Float32Array(samples.length)
  for (let i = 2; i < samples.length; i++)
    d[i] = Math.abs(samples[i] - 2 * samples[i - 1] + samples[i - 2])
  let clicks = 0
  let last = -minGap - 1
  for (let b = 0; b + BLOCK <= d.length; b += BLOCK) {
    let sum = 0
    for (let i = b; i < b + BLOCK; i++) sum += d[i]
    const threshold = Math.max(FLOOR, K * (sum / BLOCK))
    for (let i = b; i < b + BLOCK; i++) {
      if (d[i] <= threshold) continue
      // Within the gap of the previous detection: same click, extend it silently.
      if (i - last <= minGap) {
        last = i
        continue
      }
      let env = 0
      let n = 0
      for (let j = Math.max(0, i - ISO_REACH); j < Math.min(d.length, i + ISO_REACH); j++) {
        if (Math.abs(j - i) <= ISO_SKIP) continue
        env += d[j]
        n++
      }
      if (d[i] > ISO * K * (env / n)) clicks++
      last = i
    }
  }
  return clicks
}
