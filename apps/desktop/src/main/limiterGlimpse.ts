// Reads ffmpeg's per-window astats print (one frame per window, first channel) and returns
// the start, in seconds, of the window that pins the most samples to the copy's ceiling.
// Peak_count counts samples at the window's own peak, so a quiet sustained note scores high
// too: only windows that reach the loudest level of the whole copy compete.
export function pickCeilingWindow(text: string): number | null {
  const windows: { t: number; peak: number; count: number }[] = []
  for (const line of text.split('\n')) {
    const time = line.match(/pts_time:([\d.]+)/)
    if (time) {
      windows.push({ t: Number(time[1]), peak: 0, count: 0 })
      continue
    }
    const current = windows.at(-1)
    if (!current) continue
    const level = line.match(/\.(Min|Max)_level=(-?[\d.e+-]+)/)
    if (level) current.peak = Math.max(current.peak, Math.abs(Number(level[2])))
    const count = line.match(/\.Peak_count=([\d.]+)/)
    if (count) current.count = Number(count[1])
  }
  const ceiling = Math.max(0, ...windows.map((w) => w.peak))
  if (ceiling === 0) return null
  let best: { t: number; count: number } | null = null
  for (const w of windows) {
    if (w.peak === ceiling && (!best || w.count > best.count)) best = w
  }
  return best?.t ?? null
}

// Min/max per column of `length` samples of the worse copy from `from`, and of the better
// copy lined up by `lag` (worse[i] matches better[i + lag]) and scaled by `gain` to the worse
// copy's level. Flattened as lo, hi pairs. Null when the better copy does not cover the window.
export function glimpseColumns(
  worse: Float32Array,
  better: Float32Array,
  opts: { lag: number; gain: number; from: number; length: number; columns: number },
): { worse: number[]; better: number[] } | null {
  const { lag, gain, from, length, columns } = opts
  if (from < 0 || from + length > worse.length) return null
  if (from + lag < 0 || from + lag + length > better.length) return null
  const envelope = (read: (i: number) => number): number[] => {
    const out: number[] = []
    for (let c = 0; c < columns; c++) {
      let lo = Infinity
      let hi = -Infinity
      const end = Math.floor(((c + 1) * length) / columns)
      for (let i = Math.floor((c * length) / columns); i < end; i++) {
        const v = read(from + i)
        if (v < lo) lo = v
        if (v > hi) hi = v
      }
      out.push(lo, hi)
    }
    return out
  }
  return {
    worse: envelope((i) => worse[i]),
    better: envelope((i) => better[i + lag] * gain),
  }
}
