import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useRef, useState } from 'react'
import { mapWithConcurrency } from '../lib/concurrency'
import { createFocusGate } from '../lib/focusGate'
import { tracksToAnalyze } from '../lib/triage'
import type { TrackItem } from '../types'
import { spectrogramOptions } from './useSpectrogram'
import { waveformOptions } from './useWaveform'
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
  analyzeAllQuality: () => void
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

  useWindowFocus((focused) => focusGate.current.set(focused))

  // Analyzes every not-yet-measured track's spectrum at once. Capped at 3 in flight
  // (each is an ffmpeg pass) and cancellable; fetchQuery fills the shared cache the
  // list reads its verdicts from, and dedups with a concurrent hover for the same file.
  const analyzeAllQuality = useCallback((): void => {
    const targets = tracksToAnalyze(targetsRef.current, new Set())
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
        // The wave feeds the attention filters (silence left to trim, clipping) —
        // decoded here so one "analyze all" fills those buckets collection-wide
        // instead of only for tracks the user happened to open or play.
        await queryClient.fetchQuery(waveformOptions(t.inputPath))
      } catch {
        // A single file ffmpeg can't read must not abort the whole sweep — count it so
        // the run can report the total at the end instead of swallowing it.
        failed += 1
      } finally {
        done += 1
        setAnalysis((a) => (a ? { ...a, done } : a))
      }
    }).finally(() => {
      runningRef.current = false
      setAnalysis(null)
      if (failed > 0) onErrorsRef.current?.(failed)
    })
  }, [queryClient, targetsRef])

  const cancelAnalysis = useCallback((): void => {
    analyzeCancel.current = true
  }, [])

  return { analysis, analyzeAllQuality, cancelAnalysis }
}
