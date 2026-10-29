import type React from 'react'
import { useCallback, useRef } from 'react'
import { revokeDisplacedCovers } from '../lib/coverUrl'
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
  inLibraryResolved: TrackItem['inLibraryResolved']
  // The "clear all" intents ride the same snapshot as the fields they clear alongside:
  // metaCleared/coverRemoved wipe the rating and art on convert, foreignRemoved marks the
  // inspector's foreign tags for deletion. Undoing a clear must revert these too, or ⌘Z
  // leaves the track still flagged for a wipe. Stored (and restored) verbatim, including
  // undefined, so a track that wasn't flagged returns to unflagged rather than to `false`.
  metaCleared: TrackItem['metaCleared']
  coverRemoved: TrackItem['coverRemoved']
  foreignRemoved: TrackItem['foreignRemoved']
  // Present only when the operation also overwrites artwork (paste). Recording it
  // unconditionally would make undoing a plain tag sweep revert a cover the user
  // changed afterwards — the snapshot may only restore what its operation touched.
  cover?: { url: TrackItem['coverUrl']; path: TrackItem['coverPath'] }
}

interface MetaUndo {
  // Snapshots the given tracks' tags before a batch operation overwrites them;
  // cover: true also snapshots the artwork for operations that overwrite it.
  record: (targets: TrackItem[], opts?: { cover?: boolean; group?: string }) => void
  // Restores the most recent snapshot; returns how many tracks actually changed
  // (0 for an empty stack or when every recorded track has since been removed),
  // so the caller can word — or skip — its confirmation toast.
  undo: () => number
  canUndo: () => boolean
}

function stackedCovers(stack: MetaSnapshot[][]): (string | undefined)[] {
  return stack.flatMap((entry) => entry.map((s) => s.cover?.url))
}

// The session-scoped undo stack for tag operations (fill-all, find & replace, clear,
// paste, derive, release applies, auto-match, accepted reviews and cover changes).
// Only metadata, its match flags and, when asked, the artwork are recorded — file
// operations and conversions are not undoable, so this deliberately isn't a general
// history. Kept in a ref: recording must never re-render the list mid-operation, and
// the command registry reads canUndo lazily at fire time.
export function useMetaUndo(
  tracksRef: { current: TrackItem[] },
  setTracks: React.Dispatch<React.SetStateAction<TrackItem[]>>,
): MetaUndo {
  const stack = useRef<MetaSnapshot[][]>([])
  const topGroup = useRef<string | undefined>(undefined)

  const record = useCallback(
    (targets: TrackItem[], opts?: { cover?: boolean; group?: string }) => {
      if (targets.length === 0) return
      const top = stack.current.at(-1)
      const joining = top && opts?.group !== undefined && opts.group === topGroup.current
      const snapshots = targets
        .filter((t) => !joining || !top.some((s) => s.id === t.id))
        .map((t) => ({
          id: t.id,
          meta: t.meta,
          matched: t.matched,
          autoMatched: t.autoMatched,
          matchReview: t.matchReview,
          reviewMatch: t.reviewMatch,
          matchConfidence: t.matchConfidence,
          inLibraryResolved: t.inLibraryResolved,
          metaCleared: t.metaCleared,
          coverRemoved: t.coverRemoved,
          foreignRemoved: t.foreignRemoved,
          ...(opts?.cover ? { cover: { url: t.coverUrl, path: t.coverPath } } : {}),
        }))
      topGroup.current = opts?.group
      if (joining) {
        top.push(...snapshots)
        return
      }
      stack.current.push(snapshots)
      if (stack.current.length <= MAX_META_UNDO) return
      const dropped = stack.current.shift() ?? []
      revokeDisplacedCovers(
        dropped.map((s) => s.cover?.url),
        [...tracksRef.current.map((t) => t.coverUrl), ...stackedCovers(stack.current)],
      )
    },
    [tracksRef],
  )

  const undo = useCallback((): number => {
    const entry = stack.current.pop()
    topGroup.current = undefined
    if (!entry) return 0
    const byId = new Map(entry.map((s) => [s.id, s]))
    // Rows removed since the edit stay gone — the snapshot restores fields on the
    // tracks that still exist, it never resurrects a deleted row.
    const restored = tracksRef.current.filter((t) => byId.has(t.id)).length
    if (restored === 0) return 0
    const outgoing = tracksRef.current.filter((t) => byId.get(t.id)?.cover)
    revokeDisplacedCovers(
      outgoing.map((t) => t.coverUrl),
      [
        ...tracksRef.current.map((t) => {
          const cover = byId.get(t.id)?.cover
          return cover ? cover.url : t.coverUrl
        }),
        ...stackedCovers(stack.current),
      ],
    )
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
          inLibraryResolved: s.inLibraryResolved,
          metaCleared: s.metaCleared,
          coverRemoved: s.coverRemoved,
          foreignRemoved: s.foreignRemoved,
          ...(s.cover ? { coverUrl: s.cover.url, coverPath: s.cover.path } : {}),
        }
      }),
    )
    return restored
  }, [tracksRef, setTracks])

  const canUndo = useCallback(() => stack.current.length > 0, [])

  return { record, undo, canUndo }
}
