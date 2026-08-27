// Selecting a track fires audio:waveform and audio:waveform-scan together, and both used
// to decode the same file — the envelope at 4 kHz, the scan at native rate — so a play
// paid two full decodes of the same audio. They now share one native pass; this is the
// coordination that lets them.
//
// Sharing complicates cancellation. Each probe registers its own AbortController (see
// analysisCancel.ts) and loses its observer independently — the player's wave is 'urgent'
// and the strip's scan is not — so a single consumer's abort cannot kill the decode the
// other is still waiting on. The decode is reference-counted instead: every consumer that
// aborts drops out with an AbortError, and only when the last one leaves is the child
// killed. That preserves what audio:cancelAnalysis is for (a browsed-past track must stop
// burning a core) without stranding a probe that is still on screen.

function abortError(): Error {
  const err = new Error('analysis aborted')
  err.name = 'AbortError'
  return err
}

// `run` performs the decode for a path; `kill` stops the one in flight for it. Injected so
// the reference counting can be tested without spawning ffmpeg.
export function createSharedScan<T>(
  run: (inputPath: string) => Promise<T>,
  kill: (inputPath: string) => void,
): (inputPath: string, signal?: AbortSignal) => Promise<T> {
  const inFlight = new Map<string, { promise: Promise<T>; consumers: number }>()

  return function share(inputPath: string, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(abortError())
    let entry = inFlight.get(inputPath)
    if (!entry) {
      // The entry is dropped on settle so a file re-analyzed after an edit is never
      // pinned to the result of the decode that ran before it changed.
      const created: { promise: Promise<T>; consumers: number } = {
        promise: run(inputPath).finally(() => {
          if (inFlight.get(inputPath) === created) inFlight.delete(inputPath)
        }) as Promise<T>,
        consumers: 0,
      }
      inFlight.set(inputPath, created)
      entry = created
    }
    const shared = entry
    shared.consumers++
    if (!signal) return shared.promise
    return new Promise<T>((resolve, reject) => {
      let settled = false
      const onAbort = (): void => {
        if (settled) return
        settled = true
        shared.consumers--
        // Only the departure of the last consumer stops the decode; while anyone is
        // still waiting, the pass runs to completion for them.
        if (shared.consumers === 0 && inFlight.get(inputPath) === shared) {
          inFlight.delete(inputPath)
          kill(inputPath)
        }
        reject(abortError())
      }
      signal.addEventListener('abort', onAbort, { once: true })
      shared.promise.then(
        (value) => {
          if (settled) return
          settled = true
          signal.removeEventListener('abort', onAbort)
          resolve(value)
        },
        (err) => {
          if (settled) return
          settled = true
          signal.removeEventListener('abort', onAbort)
          reject(err)
        },
      )
    })
  }
}
