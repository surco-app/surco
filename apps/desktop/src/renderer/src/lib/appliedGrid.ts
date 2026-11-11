import { type EditableGrid, sameGrid } from '../../../shared/gridEdit'
import type { QueuedCues, TrackCues } from '../../../shared/types'
import { type CueDraft, draftGridChanged } from './cueDraft'
import { keptDraftOn } from './cueSession'

export interface AppliedGrid {
  kept: CueDraft | undefined
  fresh: boolean
  grid: EditableGrid | null
  gridFingerprint: string
  changed: boolean
}

export function appliedGrid(
  contentId: string,
  read: TrackCues,
  queued: QueuedCues | null,
  programGrid: EditableGrid | null,
): AppliedGrid {
  const fresh = queued !== null && queued.fingerprint === read.fingerprint
  const kept = keptDraftOn(contentId, read, queued)
  if (kept)
    return {
      kept,
      fresh,
      grid: kept.grid,
      gridFingerprint: read.gridFingerprint,
      changed: draftGridChanged(kept),
    }
  const queuedGrid = fresh ? queued.grid : undefined
  const grid = queuedGrid ?? programGrid
  return {
    kept,
    fresh,
    grid,
    gridFingerprint: queuedGrid
      ? (queued?.gridFingerprint ?? read.gridFingerprint)
      : read.gridFingerprint,
    changed: grid !== null && !sameGrid(grid, programGrid),
  }
}
