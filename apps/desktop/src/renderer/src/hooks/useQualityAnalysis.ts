import { isCancelledError, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { analysisOptions } from '../lib/analysisQueries'
import { mapWithConcurrency } from '../lib/concurrency'
import { createFocusGate } from '../lib/focusGate'
import { tracksToAnalyze } from '../lib/triage'
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

interface QualityAnalysis {
  // Progress of the "analyze quality" run (null when idle).
  analysis: { done: number; total: number } | null
  paused: boolean
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
  // Narrows the sweep to the open playlist (null: the whole working list), mirroring
  // useAutoMatch's scopeTo: what has not started outside it is set aside until it is back.
  scopeTo: (inScope: ((t: TrackItem) => boolean) | null) => void
}

// Batch quality triage: measures every not-yet-analyzed track's spectrum so a whole
// dropped folder is checked for fake-lossless rips without opening each row.
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
  const [analysis, setAnalysis] = useState<{ done: number; total: number } | null>(null)
  const analyzeCancel = useRef(false)
  // Re-entry guard read synchronously (unlike the analysis state, which lags a render),
  // so a second trigger in the same tick can't start a competing sweep — mirroring the
  // ref guards in useTrackProcessing/useAutoMatch and keeping this callback's identity
  // stable so the command registry isn't rebuilt on every progress tick.
  const runningRef = useRef(false)
  // Pauses the sweep while the window is in the background (fed by the main process's
  // blur/focus events) so it stops spawning ffmpeg until the app returns.
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
  // call, not just the first, so a track stays queued until targetsRef genuinely has it and
  // tracksToAnalyze can retire it on its own.
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

  // The open playlist. Every playlist opened adds its files to the working list, and a sweep
  // over all of them kept decoding sets the user had already left. Its tracks that have not
  // started wait in pendingRef, which sweepCandidates reads through this, so opening their
  // playlist again is what brings them back.
  const scopeRef = useRef<((t: TrackItem) => boolean) | null>(null)
  // The running pass's tracks the progress still counts and that have not finished. One the
  // scope sets aside leaves here before its turn, and the pass then skips it.
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
  useWindowFocus((next) => {
    focusGate.current.set(next)
    setFocused(next)
  })

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
  // yet — pendingRef entries are retired (see the per-track finally below) the moment
  // targetsRef genuinely reflects them, so this never re-adds a track tracksToAnalyze would
  // otherwise have dropped. What pendingRef holds for another playlist stays there either way;
  // the rows shown are held to the playlist only for a background sweep.
  const sweepCandidates = useCallback(
    (background: boolean): TrackItem[] => {
      const inScope = (t: TrackItem): boolean => !scopeRef.current || scopeRef.current(t)
      return [
        ...(background ? targetsRef.current.filter(inScope) : targetsRef.current),
        ...Array.from(pendingRef.current.values()).filter(
          (t) => inScope(t) && !targetsRef.current.some((existing) => existing.id === t.id),
        ),
      ]
    },
    [targetsRef],
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
      const targets = tracksToAnalyze(sweepCandidates(background), measuredRef.current)
      if (runningRef.current || targets.length === 0) return
      runningRef.current = true
      analyzeCancel.current = false
      runRef.current = new Map(targets.map((t) => [t.id, t]))
      let done = 0
      const failed: string[] = []
      setAnalysis({ done: 0, total: targets.length })
      void mapWithConcurrency(targets, 3, async (t) => {
        if (analyzeCancel.current) return
        // Hold here while the window is in the background so the sweep doesn't spawn
        // ffmpeg off-screen; it resumes the moment the app is focused again.
        await focusGate.current.wait()
        if (analyzeCancel.current || !runRef.current.has(t.id)) return
        // Read at the track's turn, not when it was queued: an in-place conversion that
        // renames the file meanwhile leaves the queued row on a path that no longer exists,
        // and the probe then reports a file the user can see right there as missing.
        const path = targetsRef.current.find((x) => x.id === t.id)?.inputPath ?? t.inputPath
        let evicted = false
        try {
          if (forgottenRef.current.has(t.id)) return
          await queryClient.fetchQuery(spectrogramOptions(path))
          // The wave feeds the silence attention filter (silence left to trim); the
          // clip/channel scan — a separate probe since the split — feeds the clipping
          // one. Both decoded here so a single "analyze all" fills those buckets
          // collection-wide instead of only for tracks the user opened or played.
          await queryClient.fetchQuery(waveformOptions(path))
          await queryClient.fetchQuery(waveformScanOptions(path))
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
          // Reached only when the spectrum landed: the optional probes above are allowed
          // to fail without the track counting as unmeasured.
          onMeasuredRef.current?.(t.id)
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
          if (mountedRef.current) setAnalysis((a) => (a ? { ...a, done } : a))
        }
      }).finally(() => {
        runningRef.current = false
        if (!mountedRef.current) return
        if (failed.length > 0) onErrorsRef.current?.(failed)
        // A drop that landed mid-sweep added rows to targetsRef the running pass never saw;
        // re-evaluate (excluding what this run already measured, since targetsRef's own
        // objects may not have caught up with the fetched spectrum yet) and drain before
        // idling, so an import during analysis isn't stranded. pendingRef covers a track an
        // onMetaLoaded enqueued while this pass was running and the runningRef guard dropped —
        // it stays there (untouched by the guard above) until a relaunch actually measures it.
        if (
          !analyzeCancel.current &&
          tracksToAnalyze(sweepCandidates(background), measuredRef.current).length > 0
        ) {
          analyzeAllQuality(undefined, background)
          return
        }
        measuredRef.current = new Set()
        setAnalysis(null)
      })
    },
    [queryClient, sweepCandidates, targetsRef],
  )

  const cancelAnalysis = useCallback((): void => {
    analyzeCancel.current = true
    // Drop imports queued but not yet swept and forget this run's measured ids, mirroring
    // cancelAutoMatch clearing its queue — so a cancel leaves no stale entries for the next
    // analyzeAllQuality call to resurrect.
    pendingRef.current.clear()
    measuredRef.current = new Set()
  }, [])

  // A track already decoding finishes (the work is half done) but leaves the progress, which
  // counts only the open playlist's work; one not started yet goes back to pendingRef. Its
  // playlist opened again starts the sweep over what waits there, as an import would. A row
  // removed from the list is no playlist's work: it leaves the pass without waiting anywhere.
  const scopeTo = useCallback(
    (inScope: ((t: TrackItem) => boolean) | null): void => {
      scopeRef.current = inScope
      let dropped = 0
      for (const [id, t] of runRef.current) {
        if (!inScope || inScope(t)) continue
        runRef.current.delete(id)
        if (!forgottenRef.current.has(id)) pendingRef.current.set(id, t)
        dropped += 1
      }
      if (dropped > 0) {
        setAnalysis((a) => (a && a.total - dropped > 0 ? { ...a, total: a.total - dropped } : null))
      }
      if (
        !runningRef.current &&
        Array.from(pendingRef.current.values()).some((t) => !inScope || inScope(t))
      ) {
        analyzeAllQuality(undefined, true)
      }
    },
    [analyzeAllQuality],
  )

  return {
    analysis,
    paused: analysis !== null && !focused,
    analyzeAllQuality,
    cancelAnalysis,
    forgetTracks,
    scopeTo,
  }
}
