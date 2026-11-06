import { isCancelledError, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { analysisOptions } from '../lib/analysisQueries'
import { createFocusGate } from '../lib/focusGate'
import type { TrackItem } from '../types'
import { spectrogramOptions } from './useSpectrogram'
import { waveformOptions, waveformScanOptions } from './useWaveform'
import { useWindowFocus } from './useWindowFocus'

interface Params {
  // The rows the sweep targets — App passes the visible (filtered) set, so a filter or
  // selection narrows the analysis to what the list actually shows at the moment it starts.
  // Read through a ref so analyzeAllQuality keeps a stable identity for the command registry.
  targetsRef: { readonly current: TrackItem[] }
  // The tracks the sweep could not measure, reported once when it ends. A failed file is
  // swallowed so it doesn't abort the run, but it must not pass as a silently-skipped
  // track that looks identical to one never measured. Ids rather than a count: "12 files
  // could not be analyzed" names none of them, so the user cannot find or retry the
  // twelve among six hundred. The import already flags its own failed rows this way
  // (metaReadFailed).
  onErrors?: (failedIds: string[]) => void
  // Each track the sweep measured without incident. The counterpart of onErrors, which
  // fires only when something failed and so can never clear a mark an earlier run left
  // on a track that now reads fine.
  onMeasured?: (id: string) => void
}

interface SweepProgress {
  done: number
  total: number
  stage: 'quality' | 'details'
}

interface QualityAnalysis {
  // Progress of the "analyze quality" run (null when idle).
  analysis: SweepProgress | null
  slowed: boolean
  // tracks is folded into the sweep's targets alongside targetsRef, for a caller (an
  // import's onMetaLoaded) that fires before targetsRef's render has caught up with the
  // track it just added — mirroring enqueueAutoMatch's explicit candidates argument.
  // background marks a sweep nobody clicked (an import's): only that one is held to the open
  // playlist. A click analyzes the rows shown, which is all the scope is about.
  analyzeAllQuality: (tracks?: TrackItem[], background?: boolean) => void
  // Takes rows that left the list back out of the sweep's queue. Removal is the one way a
  // queued track can stop being worth measuring without ever being measured, and nothing
  // else retires it — see the pendingRef note below.
  forgetTracks: (ids: string[]) => void
  cancelAnalysis: () => void
  // Puts the open playlist first in the sweep (null: no preference). Nothing outside it is
  // dropped: it runs once the open playlist's tracks are done.
  scopeTo: (inScope: ((t: TrackItem) => boolean) | null) => void
}

// Batch quality triage: measures every not-yet-analyzed track's spectrum so a whole
// dropped folder is checked for fake-lossless rips without opening each row.
const DJ_APP_POLL_MS = 10_000

export function useQualityAnalysis({ targetsRef, onErrors, onMeasured }: Params): QualityAnalysis {
  const queryClient = useQueryClient()
  // Bridged through a ref so analyzeAllQuality keeps a stable identity (the command
  // registry depends on it) while App's callback is recreated every render.
  const onErrorsRef = useRef(onErrors)
  onErrorsRef.current = onErrors
  const onMeasuredRef = useRef(onMeasured)
  onMeasuredRef.current = onMeasured
  // Progress (null when idle), and a cancel flag the in-flight workers poll so
  // cancelling stops new analyses without killing the ones already handed to ffmpeg.
  const [analysis, setAnalysis] = useState<SweepProgress | null>(null)
  const analyzeCancel = useRef(false)
  // Re-entry guard read synchronously (unlike the analysis state, which lags a render),
  // so a second trigger in the same tick can't start a competing sweep — mirroring the
  // ref guards in useTrackProcessing/useAutoMatch and keeping this callback's identity
  // stable so the command registry isn't rebuilt on every progress tick.
  const runningRef = useRef(false)
  const focusGate = useRef(createFocusGate())
  // IDs this run has already measured, kept across a finally-triggered relaunch (see below)
  // so a track whose targetsRef entry hasn't yet caught up with its fetched spectrum isn't
  // re-queued forever. Cleared whenever a sweep starts fresh (not a relaunch).
  const measuredRef = useRef<Set<string>>(new Set())
  // Tracks handed to analyzeAllQuality explicitly (an import's onMetaLoaded) that targetsRef
  // doesn't carry yet: bulkTracksRef is a render-time snapshot, but onMetaLoaded fires off an
  // async metadata read, ahead of the render that would add the row to it — for two tracks
  // landing close together this gap can outlive not just the triggering call but the finally's
  // relaunch check too. Kept here (mirroring enqueueAutoMatch's own queue) and drained on every
  // call, not just the first, so a track stays queued until the sweep has run every pass on
  // it, even when the editor already measured its spectrum.
  //
  // Retired on exactly two events: the track gets measured (the per-track finally below), or
  // it leaves the list (forgetTracks). Missing that second case is what made a crate emptied
  // from 621 rows down to 13 keep reporting "87/621" and keep spawning ffmpeg over files no
  // longer in the list — targetsRef had dropped them, but sweepCandidates read them straight
  // back out of here.
  const pendingRef = useRef<Map<string, TrackItem>>(new Map())

  // Ids removed from the list. Remembered rather than just deleted from pendingRef, because
  // the enqueue that strands a ghost can arrive AFTER the removal: an import's onMetaLoaded
  // fires off an async metadata read, so a track the user removes while that read is in
  // flight would be queued by a call that had no way of knowing it is gone. An id here is
  // refused re-entry until it is genuinely imported again (which clears it, below).
  const forgottenRef = useRef<Set<string>>(new Set())

  // The open playlist. Its tracks are the next the pass starts; the rest wait their turn.
  const scopeRef = useRef<((t: TrackItem) => boolean) | null>(null)
  // The running pass's tracks that have not finished, which the progress counts.
  const runRef = useRef<Map<string, TrackItem>>(new Map())

  // App calls this from its track-removal callbacks, alongside the other per-track caches it
  // evicts there (view cache, auto-match, the analysis queries).
  const forgetTracks = useCallback((ids: string[]): void => {
    for (const id of ids) {
      pendingRef.current.delete(id)
      forgottenRef.current.add(id)
    }
  }, [])

  const [focused, setFocused] = useState(true)
  const [djAppOpen, setDjAppOpen] = useState(false)
  useWindowFocus(setFocused)
  useEffect(() => {
    if (focused) {
      setDjAppOpen(false)
      return
    }
    let cancelled = false
    const ask = (): void => {
      void window.api.djAppRunning().then((open) => {
        if (!cancelled) setDjAppOpen(open)
      })
    }
    ask()
    const timer = setInterval(ask, DJ_APP_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [focused])
  const sweepOpen = focused || !djAppOpen
  useEffect(() => {
    focusGate.current.set(sweepOpen)
  }, [sweepOpen])

  // A probe can land after the owner unmounted (the window closing, a test tearing down its
  // DOM): the sweep then starts no further track and leaves React state alone, since a
  // setState once the window is gone throws instead of being dropped.
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      analyzeCancel.current = true
    }
  }, [])

  // targetsRef.current plus whatever pendingRef still holds that targetsRef doesn't carry
  // yet — pendingRef entries are retired (see the per-track finally below) once the sweep has
  // run them, so this never re-adds a track the sweep already finished. What pendingRef holds
  // for another playlist joins too; the rows shown are held to the playlist only for a
  // background sweep.
  const sweepCandidates = useCallback(
    (background: boolean): TrackItem[] => {
      const inScope = (t: TrackItem): boolean => !scopeRef.current || scopeRef.current(t)
      return [
        ...(background ? targetsRef.current.filter(inScope) : targetsRef.current),
        ...Array.from(pendingRef.current.values()).filter(
          (t) => !targetsRef.current.some((existing) => existing.id === t.id),
        ),
      ]
    },
    [targetsRef],
  )

  const sweepTargets = useCallback(
    (background: boolean): TrackItem[] =>
      sweepCandidates(background).filter(
        (t) => (!t.spectrum || pendingRef.current.has(t.id)) && !measuredRef.current.has(t.id),
      ),
    [sweepCandidates],
  )

  // Analyzes every not-yet-measured track's spectrum at once. Capped at 3 in flight
  // (each is an ffmpeg pass) and cancellable; fetchQuery fills the shared cache the
  // list reads its verdicts from, and dedups with a concurrent hover for the same file.
  //
  // tracks (optional) is folded into pendingRef and merged on top of targetsRef.current: an
  // import's onMetaLoaded fires synchronously off the metadata read, before React has
  // re-rendered bulkTracksRef with the just-added row, so targetsRef alone would see nothing
  // to sweep and no-op — the same gap enqueueAutoMatch closes by taking its candidates as an
  // argument rather than trusting a ref to be current. Kept in pendingRef (not just merged for
  // this one call) because a second track landing while the first's sweep is still running
  // would otherwise be dropped by the runningRef guard below with no later call to pick it up.
  const analyzeAllQuality = useCallback(
    (tracks?: TrackItem[], background = false): void => {
      for (const t of tracks ?? []) {
        // A re-import genuinely brings the row back (it is in the list again), so the
        // forgotten mark is lifted and the track queues normally; anything still absent
        // from the list is the stale enqueue of a removed row and is dropped.
        if (forgottenRef.current.has(t.id)) {
          if (!targetsRef.current.some((existing) => existing.id === t.id)) continue
          forgottenRef.current.delete(t.id)
        }
        pendingRef.current.set(t.id, t)
      }
      const targets = sweepTargets(background)
      if (runningRef.current || targets.length === 0) return
      runningRef.current = true
      analyzeCancel.current = false
      runRef.current = new Map(targets.map((t) => [t.id, t]))
      let done = 0
      let total = targets.length
      const failed: string[] = []
      const details: Array<{ id: string; path: string }> = []
      let detailsDone = 0
      let detailsTotal = 0
      const report = (): void => {
        if (!mountedRef.current) return
        setAnalysis(
          done < total
            ? { done, total, stage: 'quality' }
            : { done: detailsDone, total: detailsTotal, stage: 'details' },
        )
      }
      setAnalysis({ done: 0, total, stage: 'quality' })
      const waiting = new Map(runRef.current)
      const joinsFromOpenPlaylist = (inScope: (t: TrackItem) => boolean): TrackItem | undefined => {
        for (const t of pendingRef.current.values()) {
          if (runRef.current.has(t.id) || measuredRef.current.has(t.id)) continue
          if (forgottenRef.current.has(t.id) || !inScope(t)) continue
          runRef.current.set(t.id, t)
          total += 1
          report()
          return t
        }
        return undefined
      }
      const nextTrack = (): TrackItem | undefined => {
        const inScope = scopeRef.current
        let picked: TrackItem | undefined
        for (const t of waiting.values()) {
          if (!inScope || inScope(t)) {
            waiting.delete(t.id)
            return t
          }
          picked ??= t
        }
        const joined = inScope && joinsFromOpenPlaylist(inScope)
        if (joined) return joined
        if (picked) waiting.delete(picked.id)
        return picked
      }
      const measure = async (t: TrackItem): Promise<void> => {
        if (!runRef.current.has(t.id)) return
        // Read at the track's turn, not when it was queued: an in-place conversion that
        // renames the file meanwhile leaves the queued row on a path that no longer exists,
        // and the probe then reports a file the user can see right there as missing.
        const latest = targetsRef.current.find((x) => x.id === t.id) ?? t
        const path = latest.inputPath
        let evicted = false
        try {
          if (forgottenRef.current.has(t.id)) return
          if (!latest.spectrum) await queryClient.fetchQuery(spectrogramOptions(path))
          // The wave feeds the silence attention filter (silence left to trim); the
          // clip/channel scan — a separate probe since the split — feeds the clipping
          // one. Both decoded here so a single "analyze all" fills those buckets
          // collection-wide instead of only for tracks the user opened or played.
          await Promise.all([
            queryClient.fetchQuery(waveformOptions(path)),
            queryClient.fetchQuery(waveformScanOptions(path, 'low')),
          ])
          onMeasuredRef.current?.(t.id)
          details.push({ id: t.id, path })
          detailsTotal += 1
        } catch (err) {
          // A single file ffmpeg can't read must not abort the whole sweep — remember
          // WHICH one, so the run can flag those rows at the end instead of reporting a
          // bare count the user cannot act on.
          if (isCancelledError(err)) evicted = true
          else failed.push(t.id)
        } finally {
          if (runRef.current.delete(t.id)) done += 1
          if (!evicted) measuredRef.current.add(t.id)
          pendingRef.current.delete(t.id)
          report()
        }
      }
      const measureDetails = async ({ id, path }: { id: string; path: string }): Promise<void> => {
        if (!forgottenRef.current.has(id)) {
          // Each probe returns a different result type, so the fetchQuery calls are wrapped
          // as thunks: kept in one array they'd unify to a union of option shapes fetchQuery
          // can't accept, whereas each thunk keeps its own probe type monomorphic at its call.
          const rest = [
            () =>
              queryClient.fetchQuery(
                analysisOptions('loudness', path, () => window.api.loudness(path, 'low')),
              ),
            () =>
              queryClient.fetchQuery(
                analysisOptions('clicks', path, () => window.api.clicks(path, 'low')),
              ),
            () =>
              queryClient.fetchQuery(
                analysisOptions('bpm', path, () => window.api.bpm(path, 'low')),
              ),
            () =>
              queryClient.fetchQuery(
                analysisOptions('key', path, () => window.api.key(path, 'low')),
              ),
            () =>
              queryClient.fetchQuery(
                analysisOptions('properties', path, () => window.api.properties(path)),
              ),
          ]
          for (const run of rest) {
            try {
              await run()
            } catch {
              // One analysis failing (e.g. bpm on a beatless rip) must not skip the others
              // of the same track — each fills its own cache entry independently.
            }
          }
        }
        detailsDone += 1
        report()
      }
      const worker = async (lead: boolean): Promise<void> => {
        while (!analyzeCancel.current) {
          if (!lead) await focusGate.current.wait()
          const t = nextTrack()
          if (analyzeCancel.current) return
          if (t) {
            await measure(t)
            continue
          }
          const next = details.shift()
          if (!next) return
          await measureDetails(next)
        }
      }
      void Promise.all([worker(true), worker(false), worker(false)]).finally(() => {
        runningRef.current = false
        if (!mountedRef.current) return
        if (failed.length > 0) onErrorsRef.current?.(failed)
        // A drop that landed mid-sweep added rows to targetsRef the running pass never saw;
        // re-evaluate (excluding what this run already measured, since targetsRef's own
        // objects may not have caught up with the fetched spectrum yet) and drain before
        // idling, so an import during analysis isn't stranded. pendingRef covers a track an
        // onMetaLoaded enqueued while this pass was running and the runningRef guard dropped —
        // it stays there (untouched by the guard above) until a relaunch actually measures it.
        if (!analyzeCancel.current && sweepTargets(background).length > 0) {
          analyzeAllQuality(undefined, background)
          return
        }
        measuredRef.current = new Set()
        setAnalysis(null)
      })
    },
    [queryClient, sweepTargets, targetsRef],
  )

  const cancelAnalysis = useCallback((): void => {
    analyzeCancel.current = true
    // Drop imports queued but not yet swept and forget this run's measured ids, mirroring
    // cancelAutoMatch clearing its queue — so a cancel leaves no stale entries for the next
    // analyzeAllQuality call to resurrect.
    pendingRef.current.clear()
    measuredRef.current = new Set()
  }, [])

  // Opening another playlist reorders the pass and never shortens it: its tracks start next,
  // and the ones left behind still run once they are done.
  const scopeTo = useCallback(
    (inScope: ((t: TrackItem) => boolean) | null): void => {
      scopeRef.current = inScope
      if (!runningRef.current && pendingRef.current.size > 0) analyzeAllQuality(undefined, true)
    },
    [analyzeAllQuality],
  )

  return {
    analysis,
    slowed: analysis !== null && !sweepOpen,
    analyzeAllQuality,
    cancelAnalysis,
    forgetTracks,
    scopeTo,
  }
}
