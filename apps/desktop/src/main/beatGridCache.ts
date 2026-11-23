import { createHash } from 'node:crypto'
import type { GridAudit } from '../shared/gridAudit'
import { BEAT_GRID_NAMESPACE, cachedAnalysis, peekAnalysis, storeAnalysis } from './analysisCache'
import { analysisLimiter } from './analysisLimiter'
import type { BeatGridFit } from './beatGrid'
import { measureBeatGrid, measureGridAudit } from './ffmpeg'

const GRID_AUDIT_NAMESPACE = 'grid-audit-v1'

export function cachedBeatGrid(
  file: string,
  priority: 'high' | 'low' = 'high',
): Promise<BeatGridFit | null> {
  return cachedAnalysis(
    BEAT_GRID_NAMESPACE,
    file,
    () => analysisLimiter.run(() => measureBeatGrid(file), priority),
    () => true,
  )
}

export function cachedGridAudit(
  file: string,
  beats: number[],
  leadMs: number,
  priority: 'high' | 'low' = 'high',
): Promise<Omit<GridAudit, 'periodMs'> | null> {
  const grid = createHash('sha1')
    .update(`${leadMs}|${beats.join(',')}`)
    .digest('hex')
  return cachedAnalysis(`${GRID_AUDIT_NAMESPACE}-${grid}`, file, async () => {
    const known = await peekAnalysis<BeatGridFit>(BEAT_GRID_NAMESPACE, file)
    const measured = await analysisLimiter.run(
      () => measureGridAudit(file, beats, leadMs, known === null),
      priority,
    )
    if (!measured) return null
    const { windows, total, minutes, fit } = measured
    if (known === null) await storeAnalysis(BEAT_GRID_NAMESPACE, file, fit)
    const heard = (known ?? fit)?.fine?.length ?? 0
    return { windows, total, heardPerMinute: minutes > 0 ? heard / minutes : 0 }
  })
}
