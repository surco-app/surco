import { useCallback, useMemo, useRef, useState } from 'react'
import {
  autoMatchRelease,
  type DiscogsApi,
  matchTargetOf,
  tracksToAutoMatch,
} from '../lib/autoMatch'
import { mapWithConcurrency } from '../lib/concurrency'
import { buildReleaseMeta } from '../lib/release'
import type { TrackItem } from '../types'

// Auto-match fires a Discogs search plus release loads per track, so the sweep stays
// at two in flight: Discogs' ~60 req/min is shared across the whole crate, and a
// wider fan-out would burn the quota (and risk 429s) faster than it helps.
const AUTO_MATCH_CONCURRENCY = 2

interface Params {
  // Live view of the track list: the pump outlives the render that started it, so each
  // track must be read at the moment it's probed/applied, not from a closure snapshot.
  tracksRef: { readonly current: TrackItem[] }
  updateTrack: (id: string, patch: Partial<TrackItem>) => void
}

export interface AutoMatchSweep {
  // Progress of the sweep (null when idle), for the toolbar pill and the top bar.
  matching: { done: number; total: number } | null
  enqueueAutoMatch: (candidates: TrackItem[], visibleOnly: boolean) => void
  onTrackVisible: (id: string, visible: boolean) => void
  cancelAutoMatch: () => void
  // Drops a removed (or rebuilt) track from the queue/visibility registries.
  forgetTrack: (id: string) => void
  // Clears both registries when the whole list is cleared.
  reset: () => void
}

// The visibility-gated Discogs auto-match sweep. An import enqueues its files
// visible-only so a 100-track drop probes Discogs for the handful in view rather than
// the whole crate at once; the toolbar sweep enqueues everything. A single drain loops
// until nothing is ready, then idles; a fresh drop or a row scrolling into view pumps
// it again.
export function useAutoMatch({ tracksRef, updateTrack }: Params): AutoMatchSweep {
  // Sweep progress (null when idle), a cancel flag the workers poll, and a ref guard
  // so an import landing mid-sweep doesn't start a second concurrent run.
  const [matching, setMatching] = useState<{ done: number; total: number } | null>(null)
  const matchCancel = useRef(false)
  const matchingRef = useRef(false)
  // Track ids waiting for an auto-match, mapped to whether the row must be on screen
  // before it runs. The drain reads this together with which rows are currently visible.
  const matchQueue = useRef<Map<string, boolean>>(new Map())
  const visibleIds = useRef<Set<string>>(new Set())
  // Auto-match is background work: it probes Discogs at low priority so the editor's own
  // search (high priority) always jumps ahead, and the main process paces every Discogs
  // call through one shared per-minute bucket so a big crate can't earn 429s.
  const discogs = useMemo<DiscogsApi>(
    () => ({
      searchDiscogs: (q) => window.api.searchDiscogs(q, undefined, 'low'),
      getRelease: (id) => window.api.getRelease(id, undefined, 'low'),
    }),
    [],
  )

  // Probes Discogs for one track and applies a high-confidence release outright (the bar
  // autoMatchRelease enforces). Keeps the file's own cover — the release's is often smaller —
  // and only fills from the release when the file carries none, mirroring the editor's apply.
  const applyAutoMatch = useCallback(
    async (t: TrackItem): Promise<void> => {
      const m = await autoMatchRelease(t.query, matchTargetOf(t), discogs)
      if (!m || matchCancel.current) return
      // The probe ran against a snapshot taken when the pump drained the queue; an edit,
      // a manual match or a removal landing during the Discogs round-trip wins. Re-read
      // the live track and only apply to one still exactly as probed — every edit path
      // mints a new meta object, so an identity check covers all fields at once.
      const live = tracksRef.current.find((x) => x.id === t.id)
      if (!live || live.meta !== t.meta) return
      const patch = buildReleaseMeta(live.meta, m.release, m.track, {
        url: live.coverUrl,
        path: live.coverPath,
        keep: !!live.coverUrl,
      })
      updateTrack(t.id, {
        meta: patch.meta,
        coverUrl: patch.coverUrl,
        coverPath: patch.coverPath,
        autoMatched: true,
      })
    },
    [discogs, updateTrack, tracksRef],
  )

  // The queued tracks ready to probe right now: a toolbar-enqueued track always, an
  // import-enqueued one only once its row is on screen. tracksToAutoMatch then drops any
  // already matched so a re-run only fills gaps.
  const readyMatchTargets = useCallback((): TrackItem[] => {
    const visible = visibleIds.current
    const ready = tracksRef.current.filter((t) => {
      const visibleOnly = matchQueue.current.get(t.id)
      return visibleOnly !== undefined && (!visibleOnly || visible.has(t.id))
    })
    return tracksToAutoMatch(ready)
  }, [tracksRef])

  // Drains the auto-match queue against Discogs, capped and cancellable. Each pass takes the
  // tracks ready right now and probes them, so scrolling a big crate feeds the sweep the rows
  // the user is actually looking at instead of firing all hundred at import. Loops until
  // nothing's ready, then idles; a fresh drop or a row scrolling into view pumps it again. The
  // ref guard keeps a single drain running so rival pumps share one budget rather than racing.
  const pumpAutoMatch = useCallback(async (): Promise<void> => {
    if (matchingRef.current) return
    matchingRef.current = true
    matchCancel.current = false
    try {
      while (!matchCancel.current) {
        const targets = readyMatchTargets()
        if (targets.length === 0) break
        for (const t of targets) matchQueue.current.delete(t.id)
        setMatching((s) => ({ done: s?.done ?? 0, total: (s?.total ?? 0) + targets.length }))
        await mapWithConcurrency(targets, AUTO_MATCH_CONCURRENCY, async (t) => {
          try {
            if (!matchCancel.current) await applyAutoMatch(t)
          } catch {
            // One row's malformed Discogs payload must skip that track, not sink the
            // whole sweep as an unhandled rejection (mirroring the analyze sweep).
          } finally {
            setMatching((s) => (s ? { ...s, done: s.done + 1 } : s))
          }
        })
      }
    } finally {
      matchingRef.current = false
      setMatching(null)
      // A track enqueued in the instant the loop was exiting would otherwise strand until the
      // next pump; restart if anything's already ready (e.g. the toolbar "match all" click).
      if (!matchCancel.current && readyMatchTargets().length > 0) void pumpAutoMatch()
    }
  }, [applyAutoMatch, readyMatchTargets])

  // Queues tracks for auto-match and kicks the drain. visibleOnly holds an import's files back
  // until their rows are seen; the toolbar sweep passes false to match the whole view now.
  const enqueueAutoMatch = useCallback(
    (candidates: TrackItem[], visibleOnly: boolean): void => {
      for (const t of tracksToAutoMatch(candidates)) matchQueue.current.set(t.id, visibleOnly)
      void pumpAutoMatch()
    },
    [pumpAutoMatch],
  )

  // Records which rows are on screen (the list reports it via an IntersectionObserver) and
  // pumps the drain when one appears, so an import's auto-match follows the user's scroll.
  const onTrackVisible = useCallback(
    (id: string, visible: boolean): void => {
      if (visible) {
        visibleIds.current.add(id)
        void pumpAutoMatch()
      } else {
        visibleIds.current.delete(id)
      }
    },
    [pumpAutoMatch],
  )

  const cancelAutoMatch = useCallback((): void => {
    matchCancel.current = true
  }, [])

  const forgetTrack = useCallback((id: string): void => {
    matchQueue.current.delete(id)
    visibleIds.current.delete(id)
  }, [])

  const reset = useCallback((): void => {
    matchQueue.current.clear()
    visibleIds.current.clear()
  }, [])

  return { matching, enqueueAutoMatch, onTrackVisible, cancelAutoMatch, forgetTrack, reset }
}
