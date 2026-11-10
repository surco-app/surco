import type { GridFit } from '../shared/gridEdit'
import { type BeatGridFit, REKORDBOX_BEAT_AFTER_RISE_MS } from './beatGrid'

export type BeatGridOf = (file: string, priority?: 'high' | 'low') => Promise<BeatGridFit | null>

export async function sameClockFit(
  file: string | null,
  beatGrid: BeatGridOf,
  priority: 'high' | 'low',
  leadMs: number | null,
): Promise<GridFit | null> {
  if (!file || leadMs === null) return null
  const fit = await beatGrid(file, priority)
  if (!fit) return null
  return shiftedFit(fit, leadMs + REKORDBOX_BEAT_AFTER_RISE_MS)
}

export function shiftedFit(fit: BeatGridFit, lead: number): GridFit {
  const shift = (p: { ms: number; firstMs: number }) => ({
    ms: p.ms + lead,
    firstMs: p.firstMs + lead,
  })
  return {
    bpm: fit.bpm,
    firstMs: fit.firstMs + lead,
    phases: fit.phases?.map(shift),
    fine: fit.fine?.map(shift),
  }
}
