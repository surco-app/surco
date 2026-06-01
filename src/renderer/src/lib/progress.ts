import type { TrackItem } from '../types'
import type { ProcessProgress, ProcessStage } from '../../../shared/types'

// How far the per-item bar has advanced when each export phase begins. Honest
// *phase* progress, not byte progress — the AIFF encode and the Apple Music
// import expose no percentage, so we mark where in the pipeline the item is.
export const STAGE_PROGRESS: Record<ProcessStage, number> = {
  cover: 0.2,
  converting: 0.55,
  appleMusic: 0.85
}

export function applyProgress(tracks: TrackItem[], progress: ProcessProgress): TrackItem[] {
  return tracks.map((t) => (t.id === progress.id ? { ...t, stage: progress.stage } : t))
}
