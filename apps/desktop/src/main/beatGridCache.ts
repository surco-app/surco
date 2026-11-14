import { createHash } from 'node:crypto'
import type { GridAudit } from '../shared/gridAudit'
import { cachedAnalysis, storeAnalysis } from './analysisCache'
import { analysisLimiter } from './analysisLimiter'
import type { BeatGridFit } from './beatGrid'
import { measureBeatGrid, measureGridAudit } from './ffmpeg'

export const BEAT_GRID_NAMESPACE = 'beat-grid-v4'
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
    const measured = await analysisLimiter.run(
      () => measureGridAudit(file, beats, leadMs),
      priority,
    )
    if (!measured) return null
    await storeAnalysis(BEAT_GRID_NAMESPACE, file, measured.fit)
    return measured.audit
  })
}
