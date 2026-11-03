import type { GridFit } from '../shared/gridEdit'
import { SAME_CLOCK_FILE } from '../shared/gridEdit'
import { type GridVerdict, gridVerdictOf } from '../shared/gridVerdict'
import { type BeatGridFit, REKORDBOX_BEAT_AFTER_RISE_MS } from './beatGrid'

export type BeatGridOf = (file: string, priority?: 'high' | 'low') => Promise<BeatGridFit | null>

export async function sameClockFit(
  file: string | null,
  beatGrid: BeatGridOf,
  priority: 'high' | 'low' = 'high',
): Promise<GridFit | null> {
  if (!file || !SAME_CLOCK_FILE.test(file)) return null
  const fit = await beatGrid(file, priority)
  if (!fit) return null
  const lead = REKORDBOX_BEAT_AFTER_RISE_MS
  return {
    bpm: fit.bpm,
    firstMs: fit.firstMs + lead,
    phases: fit.phases?.map((p) => ({ ms: p.ms + lead, firstMs: p.firstMs + lead })),
  }
}

export function sameClockVerdict(
  grid: { ms: number }[] | undefined,
  fit: GridFit | null,
): GridVerdict | null {
  return grid && fit
    ? gridVerdictOf(
        grid.map((b) => b.ms),
        fit,
      )
    : null
}
