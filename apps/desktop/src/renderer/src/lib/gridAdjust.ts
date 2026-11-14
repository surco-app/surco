import { type GridCheck, needsGridFix } from '../../../shared/gridAudit'
import {
  autoFitGrid,
  type EditableGrid,
  type GridFit,
  gridBeats,
  SAME_TEMPO_RATIO,
} from '../../../shared/gridEdit'
import { type CueDraft, type DraftContext, reduceDraft } from './cueDraft'

export type GridReview =
  | { kind: 'tempo'; heardBpm: number; programBpm: number }
  | { kind: 'cueJump'; ms: number }
  | { kind: 'noBetter'; beforeMs: number; afterMs: number }

export type GridAdjustResult =
  | { kind: 'fine' }
  | { kind: 'unmeasured' }
  | { kind: 'adjusted'; draft: CueDraft }
  | { kind: 'review'; reason: GridReview }

function halfBeatAt(beats: number[], ms: number): number {
  const after = beats.findIndex((b) => b > ms)
  const i = Math.min(Math.max(after < 0 ? beats.length - 1 : after, 1), beats.length - 1)
  return (beats[i] - beats[i - 1]) / 2
}

const worstMsOf = (check: GridCheck): number =>
  check.kind === 'measured'
    ? Math.max(Math.abs(check.medianMs), Math.abs(check.sustainedMs))
    : Number.POSITIVE_INFINITY

export async function adjustGrid(input: {
  draft: CueDraft & { grid: EditableGrid }
  ctx: DraftContext
  beats: number[]
  fit: GridFit
  kicks: number[]
  durationMs: number
  toleranceMs: number
  zones: boolean
  checkOf: (beats: number[]) => Promise<GridCheck | null>
}): Promise<GridAdjustResult> {
  const { draft, ctx, beats: was, fit, kicks, durationMs, toleranceMs, zones, checkOf } = input
  const beatsOf = (grid: EditableGrid) => gridBeats(grid, durationMs).map((b) => b.ms)
  const before = await checkOf(was)
  if (before === null) return { kind: 'unmeasured' }
  if (!needsGridFix(before, toleranceMs)) return { kind: 'fine' }
  const grid = autoFitGrid(draft.grid, fit, 0, kicks, zones)
  const beats = beatsOf(grid)
  const next = reduceDraft(draft, { type: 'fit-grid', grid, beats }, ctx)
  const from = new Map(draft.cues.map((c) => [c.key, c.ms]))
  const jumps = next.cues
    .map((c) => {
      const ms = from.get(c.key) ?? c.ms
      return { ms: c.ms - ms, half: halfBeatAt(was, ms) }
    })
    .filter((j) => !(Math.abs(j.ms) <= j.half))
  if (jumps.length > 0) {
    const programBpm = draft.grid.bpm
    if (Math.abs(fit.bpm - programBpm) / programBpm >= SAME_TEMPO_RATIO)
      return { kind: 'review', reason: { kind: 'tempo', heardBpm: fit.bpm, programBpm } }
    const worst = jumps.reduce((a, b) => (Math.abs(b.ms) > Math.abs(a.ms) ? b : a))
    return { kind: 'review', reason: { kind: 'cueJump', ms: worst.ms } }
  }
  const after = await checkOf(beats)
  if (after === null || needsGridFix(after, toleranceMs) || worstMsOf(after) >= worstMsOf(before))
    return {
      kind: 'review',
      reason: {
        kind: 'noBetter',
        beforeMs: worstMsOf(before),
        afterMs: after === null ? Number.POSITIVE_INFINITY : worstMsOf(after),
      },
    }
  return { kind: 'adjusted', draft: next }
}
