import { useCallback, useRef, useState } from 'react'
import { searchHintsOf } from '../../../shared/metadata'
import type {
  MetaTextKey,
  SearchHints,
  SearchPriority,
  SearchProviderId,
} from '../../../shared/types'
import type { LocalActivityReport } from '../lib/activityLog'
import { type AppleMusicIndex, isInLibrary } from '../lib/appleMusicLibrary'
import {
  autoMatchRelease,
  MAX_AUTO_PROBE,
  type MatchCleanup,
  matchActivityReport,
  matchTargetOf,
  type ProbedCandidate,
  type SearchApi,
  tracksToAutoMatch,
} from '../lib/autoMatch'
import { mapWithConcurrency } from '../lib/concurrency'
import { keepCoverArg } from '../lib/coverSource'
import { fetchRelease } from '../lib/fetchRelease'
import { buildReleaseMeta } from '../lib/release'
import { matchStatKey } from '../lib/stats'
import type { TrackItem } from '../types'

// Auto-match fires a Discogs search plus release loads per track, so the sweep stays
// at two in flight: Discogs' ~60 req/min is shared across the whole crate, and a
// wider fan-out would burn the quota (and risk 429s) faster than it helps.
const AUTO_MATCH_CONCURRENCY = 2

// How long after a row scrolls into view before the sweep pumps: long enough to coalesce
// a whole scroll flick into one pump, short enough that the rows the user stops on start
// probing near-immediately.
const VISIBLE_PUMP_SETTLE_MS = 250

interface Params {
  // Live view of the track list: the pump outlives the render that started it, so each
  // track must be read at the moment it's probed/applied, not from a closure snapshot.
  tracksRef: { readonly current: TrackItem[] }
  updateTrack: (id: string, patch: Partial<TrackItem>) => void
  // Live view of the Apple Music library snapshot (null until it lands / off macOS). Read at
  // apply time so the sweep can re-check ownership against the match's canonical title/artist —
  // the same second attempt the editor makes — and pin the verdict so the list/filter agree
  // without the user having to open each row.
  libraryIndexRef: { readonly current: AppleMusicIndex | null }
  // Live view of the enabled search providers (Settings). Read at probe time so toggling
  // Bandcamp on/off takes effect without restarting the sweep. Discogs is always tried
  // first; Bandcamp, when enabled, is the fallback for what Discogs doesn't carry.
  searchProvidersRef: { readonly current: SearchProviderId[] }
  importFieldsRef: { readonly current: MetaTextKey[] }
  // Live view of the title-cleanup settings (the Naming pattern). Read at probe time so
  // editing the pattern applies to the next probe without restarting the sweep.
  matchCleanupRef: { readonly current: MatchCleanup }
  // The id of the track whose editor field currently holds focus, or null. A field buffers
  // its text and only commits to the track array on pause/blur, so for a ~200ms window the
  // user's words aren't in the live meta yet — the meta-identity guard below can't see them
  // and a match landing in that window would overwrite the row being typed into. So the
  // sweep also skips whichever track is under active edit, read at apply time.
  editingRef: { readonly current: string | null }
  // Drops a probe's verdict into the activity feed (useActivityLog.report): which release
  // won or was suggested, why, and every candidate scored along the way.
  reportActivity: (report: LocalActivityReport) => void
}

interface AutoMatchSweep {
  // Progress of the sweep (null when idle), for the toolbar pill and the top bar.
  matching: { done: number; total: number } | null
  enqueueAutoMatch: (candidates: TrackItem[]) => void
  onTrackVisible: (id: string, visible: boolean) => void
  cancelAutoMatch: () => void
  // Drops a removed (or rebuilt) track from the queue/visibility registries.
  forgetTrack: (id: string) => void
  // Clears both registries when the whole list is cleared.
  reset: () => void
  // Marks the selected track so the sweep probes it next and at high priority; null clears it.
  focusTrack: (id: string | null) => void
}

// The Discogs auto-match sweep. An import and the toolbar sweep both enqueue every
// track: a folder of a thousand files is dropped and left to run unattended, and a sweep
// that only probed the rows on screen read as "auto-match stops at 20". The rows in view
// still go first, and the main process paces every Discogs call through one shared
// per-minute bucket. A single drain loops until nothing is ready, then idles; a fresh
// drop or a row scrolling into view pumps it again.
export function useAutoMatch({
  tracksRef,
  updateTrack,
  libraryIndexRef,
  searchProvidersRef,
  importFieldsRef,
  matchCleanupRef,
  editingRef,
  reportActivity,
}: Params): AutoMatchSweep {
  // Sweep progress (null when idle), a cancel flag the workers poll, and a ref guard
  // so an import landing mid-sweep doesn't start a second concurrent run.
  const [matching, setMatching] = useState<{ done: number; total: number } | null>(null)
  const matchCancel = useRef(false)
  const matchingRef = useRef(false)
  // Cumulative progress of the active sweep: which distinct tracks were enqueued (and
  // weren't already matched) and which have been probed. Sets, not counters: an unmatched
  // track is enqueued again every time it is selected, and it is still one track. Both
  // empty when the sweep idles, so the toolbar pill reads e.g. 5/200 across a whole-crate
  // run rather than the size of the current concurrent slice.
  const sweepDone = useRef<Set<string>>(new Set())
  const sweepTotal = useRef<Set<string>>(new Set())
  // Track ids waiting for an auto-match. The drain reads this together with which rows
  // are currently visible, which decides the order and nothing else.
  const matchQueue = useRef<Set<string>>(new Set())
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
      getRelease: (result) => fetchRelease(result, priority),
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
      // Every candidate the probe scores is collected so the verdict's activity entry can
      // show the full trail — what was considered and rejected, not just the winner.
      const probes: ProbedCandidate[] = []
      const startedAt = performance.now()
      const target = matchTargetOf(t, matchCleanupRef.current)
      const m = await autoMatchRelease(
        t.query,
        target,
        // The hint title rides the same undressed title the scorer uses, so the precise
        // artist+title searches see "Sueño Latino", not the pattern-dressed tag.
        searchApiAt(priority, { ...searchHintsOf(t.meta), title: target.title || t.meta.title }),
        MAX_AUTO_PROBE,
        (c) => probes.push(c),
      )
      if (matchCancel.current) return
      const ms = Math.round(performance.now() - startedAt)
      if (!m) {
        reportActivity(matchActivityReport(t.meta.title, undefined, probes, ms))
        return
      }
      // The probe ran against a snapshot taken when the pump drained the queue; an edit,
      // a manual match or a removal landing during the Discogs round-trip wins. Re-read
      // the live track and only apply to one still exactly as probed — every edit path
      // mints a new meta object, so an identity check covers all fields at once. A stale
      // verdict is discarded silently: reporting it would describe an apply that never
      // happened.
      const live = tracksRef.current.find((x) => x.id === t.id)
      if (!live || live.meta !== t.meta || editingRef.current === t.id) return
      reportActivity(matchActivityReport(t.meta.title, m, probes, ms))
      // A 'review'-tier match is plausible but unconfirmed: flag the row with its confidence
      // for the user to confirm in the editor, but don't write the metadata — the file keeps
      // its own tags until the user accepts the suggestion. The probe's guarded tier decides,
      // never the raw confidence: a demoted title-only hit still scores above the high bar.
      if (m.tier !== 'high') {
        updateTrack(t.id, {
          matchReview: true,
          matchConfidence: m.confidence,
          // Keep the release behind the suggestion so the user can accept it in one action
          // (shortcut or click) without the editor re-probing Discogs for it.
          reviewMatch: { release: m.release, track: m.track, result: m.result },
        })
        return
      }
      const patch = buildReleaseMeta(
        live.meta,
        m.release,
        m.track,
        keepCoverArg(live),
        importFieldsRef.current,
      )
      // Re-check ownership against the release's canonical title/artist — the editor's second
      // attempt, run here for the whole crate so the filter agrees without opening each row.
      // Only pin a positive (the list recomputes the negative from the raw tags itself); the
      // library index may not have loaded yet, in which case this round just skips it.
      const index = libraryIndexRef.current
      const resolvedOwned =
        !live.musicPersistentId &&
        !!index &&
        !isInLibrary(index, {
          title: live.meta.title,
          artist: live.meta.artist,
          durationSec: live.duration,
        }) &&
        isInLibrary(index, { title: patch.meta.title, artist: patch.meta.artist })
      updateTrack(t.id, {
        meta: patch.meta,
        coverUrl: patch.coverUrl,
        coverPath: patch.coverPath,
        autoMatched: true,
        matched: true,
        matchConfidence: m.confidence,
        matchProvider: m.release.provider,
        ...(resolvedOwned ? { inLibraryResolved: true } : {}),
      })
      window.api.recordStat(matchStatKey(m.release.provider))
    },
    [
      searchApiAt,
      updateTrack,
      tracksRef,
      libraryIndexRef,
      importFieldsRef,
      matchCleanupRef,
      editingRef,
      reportActivity,
    ],
  )

  // The queued tracks ready to probe right now. tracksToAutoMatch drops any already
  // matched so a re-run only fills gaps.
  const readyMatchTargets = useCallback((): TrackItem[] => {
    const visible = visibleIds.current
    const ready = tracksRef.current.filter((t) => matchQueue.current.has(t.id))
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
    sweepDone.current.clear()
    sweepTotal.current.clear()
    setMatching(null)
  }, [])

  // Drains the auto-match queue against Discogs, capped and cancellable. Each pass takes the
  // tracks ready right now and probes them, the rows the user is looking at first. Loops until
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
              sweepDone.current.add(t.id)
              setMatching({ done: sweepDone.current.size, total: sweepTotal.current.size })
            }
          }
        })
      }
    } finally {
      matchingRef.current = false
      // matchCancel can have been set and then the queue repopulated by an
      // enqueueAutoMatch that fired while this pump was still finishing its
      // in-flight probe (its own pumpAutoMatch() call saw matchingRef still true
      // and no-opped) — that queue is real work, not a stale cancel to honor, so
      // resume instead of resetting to idle and stranding it unwatched.
      if (matchCancel.current && matchQueue.current.size > 0) {
        matchCancel.current = false
        void pumpAutoMatch()
      } else if (matchCancel.current) {
        resetProgress()
      } else if (readyMatchTargets().length > 0) {
        // A track became ready in the instant the loop was exiting; pick it up.
        void pumpAutoMatch()
      } else if (matchQueue.current.size === 0) {
        // Queue fully drained: the sweep is done.
        resetProgress()
      }
      // Otherwise rows remain queued whose tracks the list has not committed yet — keep the
      // progress shown and let the next enqueue, onTrackVisible or focusTrack pump again.
    }
  }, [applyAutoMatch, readyMatchTargets, resetProgress])

  // Queues tracks for auto-match and kicks the drain.
  const enqueueAutoMatch = useCallback(
    (candidates: TrackItem[]): void => {
      const before = sweepTotal.current.size
      for (const t of tracksToAutoMatch(candidates)) {
        matchQueue.current.add(t.id)
        sweepTotal.current.add(t.id)
      }
      if (sweepTotal.current.size > before) {
        setMatching({ done: sweepDone.current.size, total: sweepTotal.current.size })
      }
      void pumpAutoMatch()
    },
    [pumpAutoMatch],
  )

  // Records which rows are on screen (the list reports it via an IntersectionObserver) and
  // pumps the drain when one appears, so the rows the user scrolls to jump ahead of the rest.
  // The pump is coalesced behind a short timer: a scroll flick crosses dozens of rows in a
  // burst, and pumping (filter + sort + Discogs probes whose results setTracks and rebuild
  // the list) on every crossing competes with the scroll itself for the main thread. One
  // deferred pump per burst starts the probes once the scroll settles.
  const visiblePump = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onTrackVisible = useCallback(
    (id: string, visible: boolean): void => {
      if (visible) {
        visibleIds.current.add(id)
        if (visiblePump.current !== null) return
        visiblePump.current = setTimeout(() => {
          visiblePump.current = null
          void pumpAutoMatch()
        }, VISIBLE_PUMP_SETTLE_MS)
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
    if (!sweepTotal.current.delete(id)) return
    sweepDone.current.delete(id)
    setMatching({ done: sweepDone.current.size, total: sweepTotal.current.size })
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
