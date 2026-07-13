import type { TrimRange } from '../../../shared/types'

// Generous compared to a digital-silence gate (-90 dB): a vinyl track's lead-in
// is surface noise, not zeros, and the suggestion must see through it.
const THRESHOLD_DB = -60
// Backed off from the first/last audible bucket so the cut never bites a fade-in.
// Small: at 8192 buckets a bucket covers tens of milliseconds, and a fatter pad
// used to leave a visible gap between the suggested cut and the wave at deep zoom.
const PAD_SEC = 0.1
// Below this a suggestion shaves fractions of a second — noise, not help.
const MIN_TRIM_SEC = 0.5

// Where the music actually starts and ends: the edges of the first/last bucket
// above the threshold, unpadded. What the trim handles snap to while dragging —
// the spot the user is aiming for when they say "cut at the wave". Undefined for
// an empty or all-silent decode.
export function detectOnsets(wave: {
  peaks: number[]
  durationSec: number
}): { startSec: number; endSec: number } | undefined {
  const { peaks, durationSec } = wave
  if (peaks.length === 0 || durationSec <= 0) return undefined
  const threshold = 10 ** (THRESHOLD_DB / 20)
  const first = peaks.findIndex((p) => p > threshold)
  if (first === -1) return undefined
  const last = peaks.findLastIndex((p) => p > threshold)
  const bucketSec = durationSec / peaks.length
  return { startSec: first * bucketSec, endSec: (last + 1) * bucketSec }
}

// Suggests a trim from the player's decoded envelope: the onsets above, padded
// outward. Runs instantly in the renderer — no extra ffmpeg pass — because the
// suggestion only seeds the handles; the exact cut is whatever seconds the user
// confirms. Undefined means "nothing worth suggesting": a well-cut track, or an
// all-silent decode where there is no music to keep.
export function detectTrim(wave: { peaks: number[]; durationSec: number }): TrimRange | undefined {
  const onsets = detectOnsets(wave)
  if (!onsets) return undefined
  const { durationSec } = wave
  const startSec = Math.max(0, onsets.startSec - PAD_SEC)
  const endSec = Math.min(durationSec, onsets.endSec + PAD_SEC)
  const trim: TrimRange = {}
  if (startSec >= MIN_TRIM_SEC) trim.startSec = Number(startSec.toFixed(2))
  if (durationSec - endSec >= MIN_TRIM_SEC) trim.endSec = Number(endSec.toFixed(2))
  return trim.startSec === undefined && trim.endSec === undefined ? undefined : trim
}
