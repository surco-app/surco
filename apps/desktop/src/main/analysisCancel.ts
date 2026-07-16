// Cancellation for selection-driven analyses. Browsing tracks quickly used to leave
// each abandoned row's probes (spectrogram trio, loudness, waveform) decoding to
// completion, holding analysisLimiter slots the newly selected track then queued
// behind — the visible spectrum could wait 10+ seconds for ghosts. The renderer tells
// us when a track's probes lost their last consumer (audio:cancelAnalysis) and every
// job registered here for that path aborts: queued ones never take a slot, running
// ones have their ffmpeg child killed via execFile's own signal support.
//
// Only 'high' (selected/playing track) requests register. Background work — the
// import auto-analyze and the "analyze all" sweep, both 'low' — is never registered,
// so it survives the user browsing across the very rows it is sweeping.

export function createAnalysisCancelRegistry(): {
  run: <T>(inputPath: string, job: (signal: AbortSignal) => Promise<T>) => Promise<T>
  cancel: (inputPath: string) => void
} {
  const jobs = new Map<string, Set<AbortController>>()

  async function run<T>(inputPath: string, job: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController()
    let set = jobs.get(inputPath)
    if (!set) {
      set = new Set()
      jobs.set(inputPath, set)
    }
    set.add(controller)
    try {
      return await job(controller.signal)
    } finally {
      // Forget the settled job so a later cancel can never abort a fresh re-run of
      // the same path (coming back to a track registers a new controller).
      set.delete(controller)
      if (set.size === 0) jobs.delete(inputPath)
    }
  }

  function cancel(inputPath: string): void {
    for (const controller of jobs.get(inputPath) ?? []) controller.abort()
  }

  return { run, cancel }
}

export const analysisCancels = createAnalysisCancelRegistry()

// The two abort shapes cancellation produces: execFile rejects with code ABORT_ERR
// (name AbortError) when its signal fires, and the limiter throws an Error named
// AbortError for a job aborted while queued. Both mean "the user browsed away" —
// an expected outcome the IPC handlers must swallow silently, never log as a failure.
export function isAbortError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  return err.name === 'AbortError' || (err as { code?: string }).code === 'ABORT_ERR'
}
