import type { ProcessProgress, ProcessStage } from '../../../shared/types'
import type { TrackItem } from '../types'

// How far the per-item bar has advanced when each export phase begins. Honest
// *phase* progress, not byte progress — the AIFF encode and the Apple Music
// import expose no percentage, so we mark where in the pipeline the item is.
export const STAGE_PROGRESS: Record<ProcessStage, number> = {
  cover: 0.2,
  converting: 0.55,
  appleMusic: 0.85,
}

export interface SweepProgress {
  done: number
  total: number
}

// Collapses the app's long-running sweeps into one top-bar value. The determinate sweeps
// (analyze quality, auto-match, batch convert) pool their done/total so the bar reflects the
// overall work left even when several run at once; an idle sweep (total 0) contributes
// nothing. Importing tags has no fixed total, so when nothing determinate is running it
// yields an indeterminate bar (fraction null) that animates instead of filling. Returns null
// when the app is idle, so the bar can render nothing.
export function topBarProgress(
  sweeps: Array<SweepProgress | null | undefined>,
  importing: boolean,
): { fraction: number | null } | null {
  const active = sweeps.filter((s): s is SweepProgress => !!s && s.total > 0)
  const total = active.reduce((sum, s) => sum + s.total, 0)
  if (total > 0) return { fraction: active.reduce((sum, s) => sum + s.done, 0) / total }
  if (importing) return { fraction: null }
  return null
}

export function applyProgress(tracks: TrackItem[], progress: ProcessProgress): TrackItem[] {
  return tracks.map((t) => (t.id === progress.id ? { ...t, stage: progress.stage } : t))
}
