import type { TrimRange } from '../../../shared/types'

// Generous compared to a digital-silence gate (-90 dB): a vinyl track's lead-in
// is surface noise, not zeros, and the suggestion must see through it.
const THRESHOLD_DB = -60
// Backed off from the first/last audible bucket so the cut never bites a fade-in
// or the tail of a reverb the coarse buckets half-covered.
const PAD_SEC = 0.3
// Below this a suggestion shaves fractions of a second — noise, not help.
const MIN_TRIM_SEC = 0.5

// Suggests a trim from the player's decoded envelope (2048 buckets): the first and
// last bucket above the threshold bound the music, padded outward. Runs instantly
// in the renderer — no extra ffmpeg pass — because the suggestion only seeds the
// handles; the exact cut is whatever seconds the user confirms. Undefined means
// "nothing worth suggesting": a well-cut track, or an all-silent decode where
// there is no music to keep.
export function detectTrim(wave: { peaks: number[]; durationSec: number }): TrimRange | undefined {
  const { peaks, durationSec } = wave
  if (peaks.length === 0 || durationSec <= 0) return undefined
  const threshold = 10 ** (THRESHOLD_DB / 20)
  const first = peaks.findIndex((p) => p > threshold)
  if (first === -1) return undefined
  const last = peaks.findLastIndex((p) => p > threshold)
  const bucketSec = durationSec / peaks.length
  const startSec = Math.max(0, first * bucketSec - PAD_SEC)
  const endSec = Math.min(durationSec, (last + 1) * bucketSec + PAD_SEC)
  const trim: TrimRange = {}
  if (startSec >= MIN_TRIM_SEC) trim.startSec = Number(startSec.toFixed(2))
  if (durationSec - endSec >= MIN_TRIM_SEC) trim.endSec = Number(endSec.toFixed(2))
  return trim.startSec === undefined && trim.endSec === undefined ? undefined : trim
}
