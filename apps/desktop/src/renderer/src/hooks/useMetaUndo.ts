import type React from 'react'
import { useCallback, useEffect, useRef } from 'react'
import { revokeDisplacedCovers } from '../lib/coverUrl'
import type { TrackItem } from '../types'

// Bounded so a long tagging session can't hold the whole crate's history forever —
// twenty steps back covers any realistic "that sweep was a mistake" moment.
export const MAX_META_UNDO = 20

type Fields = Record<string, unknown>

interface MetaSnapshot {
  id: string
  cover: boolean
  before: Fields
  after: Fields
  pending?: Fields
}

function fieldsOf(t: TrackItem, cover: boolean): Fields {
  const { custom, ...meta } = t.meta
  return {
    ...Object.fromEntries(Object.entries(meta).map(([key, value]) => [`meta.${key}`, value])),
    ...Object.fromEntries(
      Object.entries(custom ?? {}).map(([key, value]) => [`custom.${key}`, value]),
    ),
    // Everything a batch metadata operation can touch: the tags themselves plus the match
    // flags a clear drops (matched/review/confidence and the resolved library verdict).
    // Restoring the tags without those flags would hand the track back to the auto-match
    // sweep, which would promptly overwrite the metadata the undo just brought back.
    matched: t.matched,
    autoMatched: t.autoMatched,
    matchReview: t.matchReview,
    reviewMatch: t.reviewMatch,
    matchConfidence: t.matchConfidence,
    inLibraryResolved: t.inLibraryResolved,
    // The "clear all" intents ride the same snapshot as the fields they clear alongside:
    // metaCleared/coverRemoved wipe the rating and art on convert, foreignRemoved marks the
    // inspector's foreign tags for deletion. Undoing a clear must revert these too, or ⌘Z
    // leaves the track still flagged for a wipe. Stored (and restored) verbatim, including
    // undefined, so a track that wasn't flagged returns to unflagged rather than to `false`.
    metaCleared: t.metaCleared,
    coverRemoved: t.coverRemoved,
    foreignRemoved: t.foreignRemoved,
    // Present only when the operation also overwrites artwork (paste). Recording it
    // unconditionally would make undoing a plain tag sweep revert a cover the user
    // changed afterwards — the snapshot may only restore what its operation touched.
    ...(cover ? { coverUrl: t.coverUrl, coverPath: t.coverPath } : {}),
  }
}

function withFields(t: TrackItem, fields: Fields): TrackItem {
  const meta: Fields = { ...t.meta }
  const custom: Fields = { ...t.meta.custom }
  const rest: Fields = {}
  for (const [key, value] of Object.entries(fields)) {
    if (key.startsWith('meta.')) meta[key.slice('meta.'.length)] = value
    else if (!key.startsWith('custom.')) rest[key] = value
    else if (value === undefined) delete custom[key.slice('custom.'.length)]
    else custom[key.slice('custom.'.length)] = value
  }
  const customTouched = Object.keys(fields).some((key) => key.startsWith('custom.'))
  return {
    ...t,
    ...rest,
    meta: { ...meta, ...(customTouched ? { custom } : {}) } as TrackItem['meta'],
  }
}

function settle(s: MetaSnapshot, t: TrackItem | undefined): void {
  const pending = s.pending
  s.pending = undefined
  if (!pending || !t) return
  const now = fieldsOf(t, s.cover)
  for (const key of new Set([...Object.keys(pending), ...Object.keys(now)]))
    if (pending[key] !== now[key]) s.after[key] = now[key]
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

function coversOf(entries: MetaSnapshot[][]): (string | undefined)[] {
  return entries.flatMap((entry) =>
    entry.flatMap((s) => [s.before.coverUrl, s.after.coverUrl] as (string | undefined)[]),
  )
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
  const unsettled = useRef<MetaSnapshot[]>([])

  useEffect(() => {
    if (unsettled.current.length === 0) return
    const byId = new Map(tracksRef.current.map((t) => [t.id, t]))
    for (const s of unsettled.current) settle(s, byId.get(s.id))
    unsettled.current = []
  })

  const record = useCallback(
    (targets: TrackItem[], opts?: { cover?: boolean; group?: string }) => {
      if (targets.length === 0) return
      const top = stack.current.at(-1)
      const joining = top && opts?.group !== undefined && opts.group === topGroup.current
      const cover = !!opts?.cover
      const fresh: MetaSnapshot[] = []
      for (const t of targets) {
        let s = joining ? top.find((x) => x.id === t.id) : undefined
        if (!s) {
          s = { id: t.id, cover, before: fieldsOf(t, cover), after: {} }
          fresh.push(s)
        }
        s.pending ??= fieldsOf(t, s.cover)
        unsettled.current.push(s)
      }
      topGroup.current = opts?.group
      if (joining) {
        top.push(...fresh)
        return
      }
      stack.current.push(fresh)
      if (stack.current.length <= MAX_META_UNDO) return
      const dropped = stack.current.shift() ?? []
      revokeDisplacedCovers(coversOf([dropped]), [
        ...tracksRef.current.map((t) => t.coverUrl),
        ...coversOf(stack.current),
      ])
    },
    [tracksRef],
  )

  const undo = useCallback((): number => {
    const entry = stack.current.pop()
    topGroup.current = undefined
    if (!entry) return 0
    const live = new Map(tracksRef.current.map((t) => [t.id, t]))
    // Rows removed since the edit stay gone — the snapshot restores fields on the
    // tracks that still exist, it never resurrects a deleted row.
    const kept = entry.filter((s) => live.has(s.id))
    if (kept.length === 0) return 0
    const patches = new Map<string, Fields>()
    for (const s of kept) {
      const track = live.get(s.id) as TrackItem
      settle(s, track)
      const now = fieldsOf(track, s.cover)
      const keys = Object.keys(s.after).filter((key) => now[key] === s.after[key])
      patches.set(s.id, Object.fromEntries(keys.map((key) => [key, s.before[key]])))
    }
    const restoresCover = (t: TrackItem) => 'coverUrl' in (patches.get(t.id) ?? {})
    revokeDisplacedCovers(
      tracksRef.current.filter(restoresCover).map((t) => t.coverUrl),
      [
        ...tracksRef.current.map((t) =>
          restoresCover(t) ? (patches.get(t.id)?.coverUrl as string | undefined) : t.coverUrl,
        ),
        ...coversOf(stack.current),
      ],
    )
    setTracks((prev) =>
      prev.map((t) => {
        const patch = patches.get(t.id)
        return patch ? withFields(t, patch) : t
      }),
    )
    return kept.length
  }, [tracksRef, setTracks])

  const canUndo = useCallback(() => stack.current.length > 0, [])

  return { record, undo, canUndo }
}
