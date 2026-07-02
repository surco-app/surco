import type React from 'react'
import { useCallback, useRef } from 'react'
import type { TrackItem } from '../types'

// Bounded so a long tagging session can't hold the whole crate's history forever —
// twenty steps back covers any realistic "that sweep was a mistake" moment.
export const MAX_META_UNDO = 20

// Everything a batch metadata operation can touch: the tags themselves plus the match
// flags a clear drops (matched/review/confidence and the resolved library verdict).
// Restoring the tags without those flags would hand the track back to the auto-match
// sweep, which would promptly overwrite the metadata the undo just brought back.
interface MetaSnapshot {
  id: string
  meta: TrackItem['meta']
  matched: TrackItem['matched']
  autoMatched: TrackItem['autoMatched']
  matchReview: TrackItem['matchReview']
  reviewMatch: TrackItem['reviewMatch']
  matchConfidence: TrackItem['matchConfidence']
  inAppleMusicResolved: TrackItem['inAppleMusicResolved']
}

export interface MetaUndo {
  // Snapshots the given tracks' tags before a batch operation overwrites them.
  record: (targets: TrackItem[]) => void
  // Restores the most recent snapshot; returns how many tracks actually changed
  // (0 for an empty stack or when every recorded track has since been removed),
  // so the caller can word — or skip — its confirmation toast.
  undo: () => number
  canUndo: () => boolean
}

// The session-scoped undo stack for batch tag operations (fill-all, find & replace,
// clear, paste, derive). Only metadata and its match flags are recorded — file
// operations and conversions are not undoable, so this deliberately isn't a general
// history. Kept in a ref: recording must never re-render the list mid-operation, and
// the command registry reads canUndo lazily at fire time.
export function useMetaUndo(
  tracksRef: { current: TrackItem[] },
  setTracks: React.Dispatch<React.SetStateAction<TrackItem[]>>,
): MetaUndo {
  const stack = useRef<MetaSnapshot[][]>([])

  const record = useCallback((targets: TrackItem[]) => {
    if (targets.length === 0) return
    stack.current.push(
      targets.map((t) => ({
        id: t.id,
        meta: t.meta,
        matched: t.matched,
        autoMatched: t.autoMatched,
        matchReview: t.matchReview,
        reviewMatch: t.reviewMatch,
        matchConfidence: t.matchConfidence,
        inAppleMusicResolved: t.inAppleMusicResolved,
      })),
    )
    if (stack.current.length > MAX_META_UNDO) stack.current.shift()
  }, [])

  const undo = useCallback((): number => {
    const entry = stack.current.pop()
    if (!entry) return 0
    const byId = new Map(entry.map((s) => [s.id, s]))
    // Rows removed since the edit stay gone — the snapshot restores fields on the
    // tracks that still exist, it never resurrects a deleted row.
    const restored = tracksRef.current.filter((t) => byId.has(t.id)).length
    if (restored === 0) return 0
    setTracks((prev) =>
      prev.map((t) => {
        const s = byId.get(t.id)
        if (!s) return t
        return {
          ...t,
          meta: s.meta,
          matched: s.matched,
          autoMatched: s.autoMatched,
          matchReview: s.matchReview,
          reviewMatch: s.reviewMatch,
          matchConfidence: s.matchConfidence,
          inAppleMusicResolved: s.inAppleMusicResolved,
        }
      }),
    )
    return restored
  }, [tracksRef, setTracks])

  const canUndo = useCallback(() => stack.current.length > 0, [])

  return { record, undo, canUndo }
}
