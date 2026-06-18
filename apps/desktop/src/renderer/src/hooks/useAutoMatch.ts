import { useCallback, useRef, useState } from 'react'
import type { SearchHints, SearchPriority, SearchProviderId } from '../../../shared/types'
import {
  autoMatchRelease,
  type SearchApi,
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
  // Live view of the enabled search providers (Settings). Read at probe time so toggling
  // Bandcamp on/off takes effect without restarting the sweep. Discogs is always tried
  // first; Bandcamp, when enabled, is the fallback for what Discogs doesn't carry.
  searchProvidersRef: { readonly current: SearchProviderId[] }
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
  // Marks the selected track so the sweep probes it next and at high priority; null clears it.
  focusTrack: (id: string | null) => void
}

// The visibility-gated Discogs auto-match sweep. An import enqueues its files
// visible-only so a 100-track drop probes Discogs for the handful in view rather than
// the whole crate at once; the toolbar sweep enqueues everything. A single drain loops
// until nothing is ready, then idles; a fresh drop or a row scrolling into view pumps
// it again.
export function useAutoMatch({
  tracksRef,
  updateTrack,
  searchProvidersRef,
}: Params): AutoMatchSweep {
  // Sweep progress (null when idle), a cancel flag the workers poll, and a ref guard
  // so an import landing mid-sweep doesn't start a second concurrent run.
  const [matching, setMatching] = useState<{ done: number; total: number } | null>(null)
  const matchCancel = useRef(false)
  const matchingRef = useRef(false)
  // Cumulative progress of the active sweep: how many distinct tracks were enqueued (and
  // weren't already matched) and how many have been probed. Both reset to 0 when the sweep
  // idles, so the toolbar pill reads e.g. 5/200 across a whole-crate run rather than the
  // size of the current concurrent slice.
  const sweepDone = useRef(0)
  const sweepTotal = useRef(0)
  // Track ids waiting for an auto-match, mapped to whether the row must be on screen
  // before it runs. The drain reads this together with which rows are currently visible.
  const matchQueue = useRef<Map<string, boolean>>(new Map())
  const visibleIds = useRef<Set<string>>(new Set())
  // The track the user has selected. It probes ahead of the rest of the crate (drained
  // first) and at high priority, so the row in front of you resolves now instead of
  // waiting its turn behind a folder's worth of background matches.
  const focusedId = useRef<string | null>(null)
  // Auto-match is background work: it probes Discogs at low priority so the editor's own
  // search (high priority) always jumps ahead, and the main process paces every Discogs
  // call through one shared per-minute bucket so a big crate can't earn 429s. The focused
  // track is the one exception — it rides the same high-priority lane as a manual search.
  const searchApiAt = useCallback(
    (priority: SearchPriority, hints?: SearchHints): SearchApi => ({
      search: (q, provider) => window.api.search(q, provider, priority, hints),
      getRelease: (result) =>
        window.api.getRelease(result.releaseUrl ?? result.id, result.provider, priority),
      providers: searchProvidersRef.current,
    }),
    [searchProvidersRef],
  )

  // Probes Discogs for one track and applies a high-confidence release outright (the bar
  // autoMatchRelease enforces). Keeps the file's own cover — the release's is often smaller —
  // and only fills from the release when the file carries none, mirroring the editor's apply.
  const applyAutoMatch = useCallback(
    async (t: TrackItem): Promise<void> => {
      const priority: SearchPriority = t.id === focusedId.current ? 'high' : 'low'
      const hints: SearchHints = {
        artist: t.meta.artist,
        title: t.meta.title,
        catalogNumber: t.meta.catalogNumber,
      }
      const m = await autoMatchRelease(t.query, matchTargetOf(t), searchApiAt(priority, hints))
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
    [searchApiAt, updateTrack, tracksRef],
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
    const targets = tracksToAutoMatch(ready)
    // Probe the rows on screen before the rest of the crate so the slice of the list the
    // user is looking at resolves first; V8's sort is stable, so list order holds within
    // each group. Re-evaluated every pass, so scrolling re-prioritises live.
    targets.sort((a, b) => Number(visible.has(b.id)) - Number(visible.has(a.id)))
    // The focused (selected) track jumps even ahead of the other on-screen rows.
    const i = targets.findIndex((t) => t.id === focusedId.current)
    if (i > 0) targets.unshift(targets.splice(i, 1)[0])
    return targets
  }, [tracksRef])

  // Zeroes the sweep's progress and hides the toolbar pill — used when it finishes, is
  // cancelled, or the list is cleared out from under it.
  const resetProgress = useCallback((): void => {
    sweepDone.current = 0
    sweepTotal.current = 0
    setMatching(null)
  }, [])

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
        const ready = readyMatchTargets()
        if (ready.length === 0) break
        // Take only the top-priority slice each pass, then re-evaluate: a row scrolled into
        // view (or a freshly selected one) jumps ahead of the rest of the crate on the very
        // next pass, instead of being stranded behind a whole batch already in flight.
        const batch = ready.slice(0, AUTO_MATCH_CONCURRENCY)
        for (const t of batch) matchQueue.current.delete(t.id)
        await mapWithConcurrency(batch, AUTO_MATCH_CONCURRENCY, async (t) => {
          try {
            if (!matchCancel.current) await applyAutoMatch(t)
          } catch {
            // One row's malformed Discogs payload must skip that track, not sink the
            // whole sweep as an unhandled rejection (mirroring the analyze sweep).
          } finally {
            // A cancel mid-probe tears the sweep down, so don't resurrect the pill by
            // bumping progress after it was cleared.
            if (!matchCancel.current) {
              sweepDone.current += 1
              setMatching({ done: sweepDone.current, total: sweepTotal.current })
            }
          }
        })
      }
    } finally {
      matchingRef.current = false
      if (matchCancel.current) {
        resetProgress()
      } else if (readyMatchTargets().length > 0) {
        // A track became ready in the instant the loop was exiting; pick it up.
        void pumpAutoMatch()
      } else if (matchQueue.current.size === 0) {
        // Queue fully drained: the sweep is done.
        resetProgress()
      }
      // Otherwise rows remain queued but gated on visibility — keep the progress shown and
      // let onTrackVisible/focusTrack pump again when one appears.
    }
  }, [applyAutoMatch, readyMatchTargets, resetProgress])

  // Queues tracks for auto-match and kicks the drain. visibleOnly holds an import's files back
  // until their rows are seen; the toolbar sweep passes false to match the whole view now.
  const enqueueAutoMatch = useCallback(
    (candidates: TrackItem[], visibleOnly: boolean): void => {
      let added = 0
      for (const t of tracksToAutoMatch(candidates)) {
        if (!matchQueue.current.has(t.id)) added += 1
        matchQueue.current.set(t.id, visibleOnly)
      }
      if (added > 0) {
        sweepTotal.current += added
        setMatching({ done: sweepDone.current, total: sweepTotal.current })
      }
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

  // Stops the sweep for good: flags the in-flight probes to bail, empties the queue so a
  // later scroll (onTrackVisible pumps unconditionally) can't quietly resume it, and clears
  // the pill. This is what disabling auto-match in Settings calls, and the toolbar cancel.
  const cancelAutoMatch = useCallback((): void => {
    matchCancel.current = true
    matchQueue.current.clear()
    resetProgress()
  }, [resetProgress])

  const forgetTrack = useCallback((id: string): void => {
    matchQueue.current.delete(id)
    visibleIds.current.delete(id)
  }, [])

  const reset = useCallback((): void => {
    matchCancel.current = true
    matchQueue.current.clear()
    visibleIds.current.clear()
    focusedId.current = null
    resetProgress()
  }, [resetProgress])

  // The selection changed: point the sweep at the new row and pump so it re-drains with that
  // track at the front. A drain already running picks the new focus up on its next pass.
  const focusTrack = useCallback(
    (id: string | null): void => {
      focusedId.current = id
      if (id) void pumpAutoMatch()
    },
    [pumpAutoMatch],
  )

  return {
    matching,
    enqueueAutoMatch,
    onTrackVisible,
    cancelAutoMatch,
    forgetTrack,
    reset,
    focusTrack,
  }
}
