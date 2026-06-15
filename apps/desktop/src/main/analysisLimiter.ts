import os from 'node:os'

// A concurrency limiter (not a rate limiter like discogsLimiter): it caps how many
// analysis ffmpeg decodes run at once and serves a two-tier priority queue. Every
// analysis used to decode in parallel, so selecting a track (spectrum + loudness +
// bpm + key) and then hitting play (waveform) put five ffmpeg passes on the cores at
// once — each then crawled, and the waveform a DJ was actively waiting on suffered
// most. Capping the burst keeps each decode fast, and 'high' lets the waveform jump
// ahead of the background passes when every slot is busy.
type Resolve = () => void

export function createConcurrencyLimiter(max: number): {
  run: <T>(task: () => Promise<T>, priority?: 'high' | 'low') => Promise<T>
} {
  let active = 0
  const high: Resolve[] = []
  const low: Resolve[] = []

  // One waiter per call, so the invariant "a queue is non-empty only while every slot
  // is busy" holds and a single dispatch per event keeps concurrency at the cap.
  function pump(): void {
    if (active >= max) return
    const next = high.shift() ?? low.shift()
    if (!next) return
    active++
    next()
  }

  async function run<T>(task: () => Promise<T>, priority: 'high' | 'low' = 'low'): Promise<T> {
    await new Promise<void>((resolve) => {
      ;(priority === 'high' ? high : low).push(resolve)
      pump()
    })
    try {
      return await task()
    } finally {
      active--
      pump()
    }
  }

  return { run }
}

// Half the logical cores (min 2): leaves headroom for the audio element, the UI and
// ffmpeg's own threading so an analysis burst can't starve playback, while still
// running enough in parallel that a batch quality sweep isn't crawling one file at a
// time. The shared instance every analysis IPC handler routes its decode through.
const MAX_CONCURRENT_ANALYSES = Math.max(2, Math.floor(os.cpus().length / 2))

export const analysisLimiter = createConcurrencyLimiter(MAX_CONCURRENT_ANALYSES)
