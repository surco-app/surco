import { cachedAnalysis } from './analysisCache'
import { analysisLimiter } from './analysisLimiter'
import type { BeatGridFit } from './beatGrid'
import { measureBeatGrid } from './ffmpeg'

export const BEAT_GRID_NAMESPACE = 'beat-grid-v3'

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
