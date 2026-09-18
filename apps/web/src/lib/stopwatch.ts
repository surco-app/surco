// The Cronómetro section as a pure function of elapsed real milliseconds. The bars run
// at real time — a 203 ms conversion fills its lane in 203 ms — so the frame is simply
// "where would each operation be, t ms after pressing start", which makes the replay,
// the end state and the reduced-motion jump the same code path with a different t.

// Measured 2026-09-18 on a Mac with an M-series chip, local disk, through the app's own
// conversion and analysis code (not ffmpeg on its own): a 6:23 FLAC of 51 MB, tagged,
// with a 700×700 cover. Import is the cold read of one file (three processes: the
// probe, the cover thumbnail, the third-party tags). Update is the same-format path
// (byte copy, TagLib, and the decode that verifies the output). Convert is FLAC→AIFF
// with tags, Traktor cues and the same verification. The verdict is the spectrum's 12
// three-second windows plus the shelf pass and the spectrogram image. Normalize is the
// EBU R128 measurement with true peak plus the encode; with the editor's loudness
// section already opened for that track the measurement is shared and it drops to 760.
export const OPS = [
  { key: 'import', ms: 25 },
  { key: 'update', ms: 168 },
  { key: 'convert', ms: 203 },
  { key: 'verdict', ms: 600 },
  { key: 'normalize', ms: 2058 },
] as const satisfies readonly { key: string; ms: number }[]

export const NORMALIZE_WARM_MS = 760
// The same normalization before the measurement moved to ebur128 (2026-09-18): 5686 ms
// of loudnorm's own measuring pass on top of the encode.
export const NORMALIZE_BEFORE_MS = 6452

const STARTS = OPS.reduce<number[]>(
  (acc, op) => {
    acc.push((acc.at(-1) ?? 0) + op.ms)
    return acc
  },
  [0],
).slice(0, OPS.length)

export const STOPWATCH_END = OPS.reduce((sum, op) => sum + op.ms, 0)

export interface StopwatchRow {
  progress: number
  elapsedMs: number
  running: boolean
  done: boolean
}

export interface StopwatchFrame {
  elapsedMs: number
  rows: StopwatchRow[]
  done: boolean
}

export function stopwatchFrame(t: number): StopwatchFrame {
  // Clamped once so every derived value is safe: the reduced-motion path and a replay
  // both call this with the end value, and a rAF can overshoot it by a frame.
  const clamped = Math.min(Math.max(t, 0), STOPWATCH_END)
  const rows = OPS.map((op, i) => {
    const local = clamped - STARTS[i]
    if (local <= 0) return { progress: 0, elapsedMs: 0, running: false, done: false }
    const progress = Math.min(1, local / op.ms)
    return {
      progress,
      elapsedMs: Math.round(progress * op.ms),
      running: progress < 1,
      done: progress >= 1,
    }
  })
  return { elapsedMs: clamped, rows, done: clamped >= STOPWATCH_END }
}
