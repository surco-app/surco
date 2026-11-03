export const OFF_GRID_TOLERANCE_MS = 10

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

export function cuesOffGrid(
  cues: number[],
  beats: number[],
  toleranceMs: number = OFF_GRID_TOLERANCE_MS,
): boolean {
  if (beats.length < 2) return false
  return cues.some((ms) => distanceToBeat(ms, beats) > toleranceMs)
}
