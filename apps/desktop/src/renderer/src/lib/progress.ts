import type { ProcessStage } from '../../../shared/types'

// How far the per-item bar has advanced when each export phase begins. Honest
// *phase* progress, not byte progress — the AIFF encode and the Apple Music
// import expose no percentage, so we mark where in the pipeline the item is.
export const STAGE_PROGRESS: Record<ProcessStage, number> = {
  cover: 0.2,
  converting: 0.55,
  tags: 0.55,
  appleMusic: 0.85,
  appleMusicUpdate: 0.85,
  appleMusicReplace: 0.85,
  engineDj: 0.85,
  verify: 0.95,
}

interface SweepProgress {
  done: number
  total: number
}

// Collapses the app's long-running sweeps into one top-bar value: the first running sweep
// drives it; an idle sweep (total 0) contributes nothing. Importing tags has no fixed total,
// so when nothing determinate is running it yields an indeterminate bar (fraction null) that
// animates instead of filling. Returns null when the app is idle, so the bar can render nothing.
export function topBarProgress(
  sweeps: Array<SweepProgress | null | undefined>,
  importing: boolean,
): { fraction: number | null } | null {
  const lead = sweeps.find((s): s is SweepProgress => !!s && s.total > 0)
  if (lead) return { fraction: lead.done / lead.total }
  if (importing) return { fraction: null }
  return null
}

export type SweepTask =
  | { kind: 'import'; done: number; total: number }
  | { kind: 'analyze'; done: number; total: number; stage?: 'quality' | 'details' }
  | { kind: 'match'; done: number; total: number; waiting: number }

export function sweepTasks({
  importing,
  analysis,
  matching,
}: {
  importing: SweepProgress | null
  analysis: (SweepProgress & { stage?: 'quality' | 'details' }) | null
  matching: SweepProgress | null
}): SweepTask[] {
  const tasks: SweepTask[] = []
  const unread = importing && importing.total > 0 ? importing.total - importing.done : 0
  if (importing && importing.total > 0) tasks.push({ kind: 'import', ...importing })
  if (analysis && analysis.total > 0) tasks.push({ kind: 'analyze', ...analysis })
  if (matching && matching.total > 0) {
    tasks.push({
      kind: 'match',
      done: matching.done,
      total: matching.total + unread,
      waiting: matching.total - matching.done,
    })
  }
  return tasks
}
