import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useRef, useState } from 'react'
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
  // Fired once when a sweep ends having had files ffmpeg couldn't read, with how many.
  // A failed file is swallowed so it doesn't abort the run, but it must not pass as a
  // silently-skipped track that looks identical to one never measured.
  onErrors?: (count: number) => void
}

export interface QualityAnalysis {
  // Progress of the "analyze quality" run (null when idle).
  analysis: { done: number; total: number } | null
  // tracks is folded into the sweep's targets alongside targetsRef, for a caller (an
  // import's onMetaLoaded) that fires before targetsRef's render has caught up with the
  // track it just added — mirroring enqueueAutoMatch's explicit candidates argument.
  analyzeAllQuality: (tracks?: TrackItem[]) => void
  cancelAnalysis: () => void
}

// Batch quality triage: measures every not-yet-analyzed track's spectrum so a whole
// dropped folder is checked for fake-lossless rips without opening each row.
export function useQualityAnalysis({ targetsRef, onErrors }: Params): QualityAnalysis {
  const queryClient = useQueryClient()
  // Bridged through a ref so analyzeAllQuality keeps a stable identity (the command
  // registry depends on it) while App's callback is recreated every render.
  const onErrorsRef = useRef(onErrors)
  onErrorsRef.current = onErrors
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
  const pendingRef = useRef<Map<string, TrackItem>>(new Map())

  useWindowFocus((focused) => focusGate.current.set(focused))

  // targetsRef.current plus whatever pendingRef still holds that targetsRef doesn't carry
  // yet — pendingRef entries are retired (see the per-track finally below) the moment
  // targetsRef genuinely reflects them, so this never re-adds a track tracksToAnalyze would
  // otherwise have dropped.
  const sweepCandidates = useCallback(
    (): TrackItem[] => [
      ...targetsRef.current,
      ...Array.from(pendingRef.current.values()).filter(
        (t) => !targetsRef.current.some((existing) => existing.id === t.id),
      ),
    ],
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
  const analyzeAllQuality = useCallback((tracks?: TrackItem[]): void => {
    for (const t of tracks ?? []) pendingRef.current.set(t.id, t)
    const targets = tracksToAnalyze(sweepCandidates(), measuredRef.current)
    if (runningRef.current || targets.length === 0) return
    runningRef.current = true
    analyzeCancel.current = false
    let done = 0
    let failed = 0
    setAnalysis({ done: 0, total: targets.length })
    void mapWithConcurrency(targets, 3, async (t) => {
      if (analyzeCancel.current) return
      // Hold here while the window is in the background so the sweep doesn't spawn
      // ffmpeg off-screen; it resumes the moment the app is focused again.
      await focusGate.current.wait()
      if (analyzeCancel.current) return
      try {
        await queryClient.fetchQuery(spectrogramOptions(t.inputPath))
        // The wave feeds the silence attention filter (silence left to trim); the
        // clip/channel scan — a separate probe since the split — feeds the clipping
        // one. Both decoded here so a single "analyze all" fills those buckets
        // collection-wide instead of only for tracks the user opened or played.
        await queryClient.fetchQuery(waveformOptions(t.inputPath))
        await queryClient.fetchQuery(waveformScanOptions(t.inputPath))
        // Each probe returns a different result type, so the fetchQuery calls are wrapped
        // as thunks: kept in one array they'd unify to a union of option shapes fetchQuery
        // can't accept, whereas each thunk keeps its own probe type monomorphic at its call.
        const rest = [
          () =>
            queryClient.fetchQuery(
              analysisOptions('loudness', t.inputPath, () => window.api.loudness(t.inputPath, 'low')),
            ),
          () =>
            queryClient.fetchQuery(
              analysisOptions('clicks', t.inputPath, () => window.api.clicks(t.inputPath, 'low')),
            ),
          () =>
            queryClient.fetchQuery(
              analysisOptions('bpm', t.inputPath, () => window.api.bpm(t.inputPath, 'low')),
            ),
          () =>
            queryClient.fetchQuery(
              analysisOptions('key', t.inputPath, () => window.api.key(t.inputPath, 'low')),
            ),
          () =>
            queryClient.fetchQuery(
              analysisOptions('properties', t.inputPath, () => window.api.properties(t.inputPath)),
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
      } catch {
        // A single file ffmpeg can't read must not abort the whole sweep — count it so
        // the run can report the total at the end instead of swallowing it.
        failed += 1
      } finally {
        done += 1
        measuredRef.current.add(t.id)
        pendingRef.current.delete(t.id)
        setAnalysis((a) => (a ? { ...a, done } : a))
      }
    }).finally(() => {
      runningRef.current = false
      if (failed > 0) onErrorsRef.current?.(failed)
      // A drop that landed mid-sweep added rows to targetsRef the running pass never saw;
      // re-evaluate (excluding what this run already measured, since targetsRef's own
      // objects may not have caught up with the fetched spectrum yet) and drain before
      // idling, so an import during analysis isn't stranded. pendingRef covers a track an
      // onMetaLoaded enqueued while this pass was running and the runningRef guard dropped —
      // it stays there (untouched by the guard above) until a relaunch actually measures it.
      if (!analyzeCancel.current && tracksToAnalyze(sweepCandidates(), measuredRef.current).length > 0) {
        analyzeAllQuality()
        return
      }
      measuredRef.current = new Set()
      setAnalysis(null)
    })
  }, [queryClient, sweepCandidates])

  const cancelAnalysis = useCallback((): void => {
    analyzeCancel.current = true
    // Drop imports queued but not yet swept and forget this run's measured ids, mirroring
    // cancelAutoMatch clearing its queue — so a cancel leaves no stale entries for the next
    // analyzeAllQuality call to resurrect.
    pendingRef.current.clear()
    measuredRef.current = new Set()
  }, [])

  return { analysis, analyzeAllQuality, cancelAnalysis }
}
