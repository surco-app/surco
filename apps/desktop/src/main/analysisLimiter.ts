import os from 'node:os'

// A concurrency limiter (not a rate limiter like discogsLimiter): it caps how many
// analysis ffmpeg decodes run at once and serves a three-tier priority queue. Every
// analysis used to decode in parallel, so selecting a track (spectrum + loudness +
// bpm + key) and then hitting play (waveform) put five ffmpeg passes on the cores at
// once — each then crawled, and the waveform a DJ was actively waiting on suffered
// most. Capping the burst keeps each decode fast. The tiers: 'urgent' for the one
// decode a user is staring at (the player waveform), 'high' for the other passes of
// the actively-selected track, 'low' for background/sweep work. 'urgent' exists
// because selecting a track fires spectrum/shelf/loudness as 'high' too — the waveform
// used to wait behind its own track's background passes even though it was 'high'.
type Priority = 'urgent' | 'high' | 'low'
type Waiter = { resolve: () => void; signal?: AbortSignal }

function abortError(): Error {
  const err = new Error('analysis aborted')
  err.name = 'AbortError'
  return err
}

export function createConcurrencyLimiter(max: number): {
  run: <T>(task: () => Promise<T>, priority?: Priority, signal?: AbortSignal) => Promise<T>
} {
  let active = 0
  const urgent: Waiter[] = []
  const high: Waiter[] = []
  const low: Waiter[] = []

  // One waiter per call, so the invariant "a queue is non-empty only while every slot
  // is busy" holds and a single dispatch per event keeps concurrency at the cap.
  // Waiters whose signal aborted while queued are skimmed off here rather than
  // eagerly removed on abort: their run() already rejected, so all a stale entry
  // could do is waste a shift, never a slot.
  function pump(): void {
    if (active >= max) return
    let next = urgent.shift() ?? high.shift() ?? low.shift()
    while (next?.signal?.aborted) next = urgent.shift() ?? high.shift() ?? low.shift()
    if (!next) return
    active++
    next.resolve()
  }

  // The signal only governs the wait: aborted before a slot frees (or on entry) the
  // call rejects with AbortError and never runs. Once the task starts, killing its
  // ffmpeg child is the task's own job (execFile consumes the same signal) — the
  // limiter just keeps the slot accounted for until the task settles.
  async function run<T>(
    task: () => Promise<T>,
    priority: Priority = 'low',
    signal?: AbortSignal,
  ): Promise<T> {
    if (signal?.aborted) throw abortError()
    await new Promise<void>((resolve, reject) => {
      const waiter: Waiter = { resolve, signal }
      signal?.addEventListener('abort', () => reject(abortError()), { once: true })
      const queue = priority === 'urgent' ? urgent : priority === 'high' ? high : low
      queue.push(waiter)
      pump()
    })
    // Past this point the slot is held (pump incremented active before resolving),
    // so even an abort that raced the grant must flow through the finally to free it.
    try {
      if (signal?.aborted) throw abortError()
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
