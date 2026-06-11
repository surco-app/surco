import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { mapWithConcurrency } from '../lib/concurrency'
import { createFocusGate } from '../lib/focusGate'
import { tracksToAnalyze } from '../lib/triage'
import type { TrackItem } from '../types'
import { spectrogramOptions } from './useSpectrogram'

interface Params {
  // Live spectrum-merged view of the tracks, so the sweep targets what the list
  // actually shows at the moment it starts.
  tracksViewRef: { readonly current: TrackItem[] }
}

export interface QualityAnalysis {
  // Progress of the "analyze quality" run (null when idle).
  analysis: { done: number; total: number } | null
  analyzeAllQuality: () => void
  cancelAnalysis: () => void
}

// Batch quality triage: measures every not-yet-analyzed track's spectrum so a whole
// dropped folder is checked for fake-lossless rips without opening each row.
export function useQualityAnalysis({ tracksViewRef }: Params): QualityAnalysis {
  const queryClient = useQueryClient()
  // Progress (null when idle), and a cancel flag the in-flight workers poll so
  // cancelling stops new analyses without killing the ones already handed to ffmpeg.
  const [analysis, setAnalysis] = useState<{ done: number; total: number } | null>(null)
  const analyzeCancel = useRef(false)
  // Pauses the sweep while the window is in the background (fed by the main process's
  // blur/focus events) so it stops spawning ffmpeg until the app returns.
  const focusGate = useRef(createFocusGate())

  useEffect(() => window.api.onWindowFocus((focused) => focusGate.current.set(focused)), [])

  // Analyzes every not-yet-measured track's spectrum at once. Capped at 3 in flight
  // (each is an ffmpeg pass) and cancellable; fetchQuery fills the shared cache the
  // list reads its verdicts from, and dedups with a concurrent hover for the same file.
  const analyzeAllQuality = useCallback((): void => {
    const targets = tracksToAnalyze(tracksViewRef.current, new Set())
    if (analysis || targets.length === 0) return
    analyzeCancel.current = false
    let done = 0
    setAnalysis({ done: 0, total: targets.length })
    void mapWithConcurrency(targets, 3, async (t) => {
      if (analyzeCancel.current) return
      // Hold here while the window is in the background so the sweep doesn't spawn
      // ffmpeg off-screen; it resumes the moment the app is focused again.
      await focusGate.current.wait()
      if (analyzeCancel.current) return
      try {
        await queryClient.fetchQuery(spectrogramOptions(t.inputPath))
      } catch {
        // A single file ffmpeg can't read must not abort the whole sweep.
      } finally {
        done += 1
        setAnalysis((a) => (a ? { ...a, done } : a))
      }
    }).finally(() => setAnalysis(null))
  }, [analysis, queryClient, tracksViewRef])

  const cancelAnalysis = useCallback((): void => {
    analyzeCancel.current = true
  }, [])

  return { analysis, analyzeAllQuality, cancelAnalysis }
}
