import { nearestBeatMs } from './cueGrid'
import type { GridFit } from './gridEdit'

export type GridVerdict = { kind: 'shifted'; ms: number } | { kind: 'drifting'; msPerMin: number }

const MIN_STRETCHES = 8
const MAX_HALF_BEAT_SHARE = 0.3
const MAX_SPREAD_MS = 5
const DRIFT_MS_PER_MIN = 3
const SHIFT_MS = 15

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

export function gridVerdictOf(beats: number[], fit: GridFit): GridVerdict | null {
  const phases = fit.phases ?? []
  if (beats.length < 2 || phases.length < MIN_STRETCHES) return null
  const period = 60000 / fit.bpm
  const measured = phases.map((p) => {
    const beat = nearestBeatMs(p.ms, beats)
    const detected = p.firstMs + Math.round((beat - p.firstMs) / period) * period
    return { min: p.ms / 60000, offset: beat - detected }
  })
  const steady = measured.filter((m) => Math.abs(m.offset) <= period / 4)
  if (steady.length < MIN_STRETCHES) return null
  if (1 - steady.length / measured.length > MAX_HALF_BEAT_SHARE) return null
  const meanMin = steady.reduce((a, m) => a + m.min, 0) / steady.length
  const meanOffset = steady.reduce((a, m) => a + m.offset, 0) / steady.length
  const den = steady.reduce((a, m) => a + (m.min - meanMin) ** 2, 0) || 1
  const slope = steady.reduce((a, m) => a + (m.min - meanMin) * (m.offset - meanOffset), 0) / den
  const spread = median(
    steady.map((m) => Math.abs(m.offset - (meanOffset + slope * (m.min - meanMin)))),
  )
  if (spread > MAX_SPREAD_MS) return null
  if (Math.abs(slope) >= DRIFT_MS_PER_MIN)
    return { kind: 'drifting', msPerMin: Math.round(slope * 10) / 10 }
  const shift = median(steady.map((m) => m.offset))
  if (Math.abs(shift) > SHIFT_MS) return { kind: 'shifted', ms: Math.round(shift) }
  return null
}
