import { checkGrid, needsGridFix } from '../../../shared/gridCheck'
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
  | { kind: 'adjusted'; draft: CueDraft }
  | { kind: 'review'; reason: GridReview }

function halfBeatAt(beats: number[], ms: number): number {
  const after = beats.findIndex((b) => b > ms)
  const i = Math.min(Math.max(after < 0 ? beats.length - 1 : after, 1), beats.length - 1)
  return (beats[i] - beats[i - 1]) / 2
}

export function adjustGrid(input: {
  draft: CueDraft & { grid: EditableGrid }
  ctx: DraftContext
  fit: GridFit
  kicks: number[]
  durationMs: number
  toleranceMs: number
  zones: boolean
}): GridAdjustResult {
  const { draft, ctx, fit, kicks, durationMs, toleranceMs, zones } = input
  const beatsOf = (grid: EditableGrid) => gridBeats(grid, durationMs).map((b) => b.ms)
  const check = (beats: number[]) => checkGrid({ beats, kicks, fit, atMs: 0, durationMs })
  const was = beatsOf(draft.grid)
  const before = check(was)
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
  const after = check(beats)
  if (needsGridFix(after, toleranceMs) || after.worstMs >= before.worstMs)
    return {
      kind: 'review',
      reason: { kind: 'noBetter', beforeMs: before.worstMs, afterMs: after.worstMs },
    }
  return { kind: 'adjusted', draft: next }
}
