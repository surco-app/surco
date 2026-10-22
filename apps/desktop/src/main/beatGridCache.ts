import { cachedAnalysis } from './analysisCache'
import { analysisLimiter } from './analysisLimiter'
import type { BeatGridFit } from './beatGrid'
import { measureBeatGrid } from './ffmpeg'

export const BEAT_GRID_NAMESPACE = 'beat-grid-v1'

export function cachedBeatGrid(file: string): Promise<BeatGridFit | null> {
  return cachedAnalysis(
    BEAT_GRID_NAMESPACE,
    file,
    () => analysisLimiter.run(() => measureBeatGrid(file), 'high'),
    () => true,
  )
}
