import { nearestBeat } from '../cueRules'
import type { DropInput, TasteTrack } from './types'

export function hashOf(text: string): number {
  let h = 2166136261
  for (const c of text) {
    h ^= c.charCodeAt(0)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h
}

export function barIndexOf(grid: DropInput['grid'], ms: number): number {
  const beat = nearestBeat(
    grid.map((b) => b.ms),
    ms,
  )
  let bars = 0
  for (let i = 0; i <= beat; i++) if (grid[i].beat === 1) bars++
  return bars - 1
}

export function fingerprintOf(candidates: TasteTrack['candidates']): string {
  const text = candidates
    .map((c) => `${c.bar}:${c.features.map((f) => f.toFixed(3)).join(',')}`)
    .join(';')
  return `${hashOf(text).toString(36)}${hashOf(`#${text}`).toString(36)}`
}

export function roundedCandidates(candidates: TasteTrack['candidates']): TasteTrack['candidates'] {
  return candidates.map((c) => ({
    bar: c.bar,
    features: c.features.map((f) => Number(f.toFixed(3))),
  }))
}
