export const CUE_GRID_TOLERANCE = [5, 10, 20] as const

export type CueGridTolerance = (typeof CUE_GRID_TOLERANCE)[number]

export const DEFAULT_CUE_GRID_TOLERANCE: CueGridTolerance = 10

export function normalizeCueGridTolerance(value: unknown): CueGridTolerance {
  return CUE_GRID_TOLERANCE.find((ms) => ms === value) ?? DEFAULT_CUE_GRID_TOLERANCE
}

function distanceToBeat(ms: number, beats: number[]): number {
  const last = beats.length - 1
  if (ms <= beats[0]) return distanceToExtended(beats[0] - ms, beats[1] - beats[0])
  if (ms >= beats[last]) return distanceToExtended(ms - beats[last], beats[last] - beats[last - 1])
  let lo = 0
  let hi = last
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (beats[mid] <= ms) lo = mid
    else hi = mid
  }
  return Math.min(ms - beats[lo], beats[hi] - ms)
}

function distanceToExtended(beyond: number, period: number): number {
  const into = beyond % period
  return Math.min(into, period - into)
}

export function cueGridDrift(cues: number[], beats: number[]): number | null {
  if (beats.length < 2 || cues.length === 0) return null
  return Math.max(...cues.map((ms) => distanceToBeat(ms, beats)))
}
