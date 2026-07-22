// Foreground searches must never wait behind a backlog of background work, so callers tag
// each acquire. 'high' is served before any 'low' the moment a token frees.
export type Priority = 'high' | 'low'

export interface RateLimiter {
  // Resolves once a token is free. Callers must await it before making the rate-limited call.
  acquire: (priority?: Priority) => Promise<void>
}

// The bit of wall-clock the limiter needs, injected so tests can drive virtual time.
interface RateClock {
  now: () => number
  delay: (ms: number) => Promise<void>
}

const realClock: RateClock = {
  now: () => Date.now(),
  delay: (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms))),
}

// Token bucket: starts full with `capacity` tokens and refills continuously at `capacity`
// tokens per `windowMs`. A small drop's worth of requests goes through instantly; once the
// bucket empties, callers queue and are released as tokens accrue, holding the sustained rate
// at the cap. Discogs allows ~60 requests/min per token and a folder drop fans auto-match,
// the editor's search and hover prefetch at it all at once, so every Discogs request takes a
// token first. High-priority waiters (the track the user is looking at) jump ahead of the
// low-priority background sweep, so individual search always prevails over auto-match.
export function createRateLimiter(
  capacity: number,
  windowMs: number,
  clock: RateClock = realClock,
): RateLimiter {
  const refillPerMs = capacity / windowMs
  let tokens = capacity
  let last = clock.now()
  const high: Array<() => void> = []
  const low: Array<() => void> = []
  let timing = false

  function refill(): void {
    const t = clock.now()
    tokens = Math.min(capacity, tokens + (t - last) * refillPerMs)
    last = t
  }

  function pump(): void {
    refill()
    while (tokens >= 1 && (high.length > 0 || low.length > 0)) {
      tokens -= 1
      const resolve = high.shift() ?? (low.shift() as () => void)
      resolve()
    }
    // Still owed tokens: wake once enough time has passed for the next one, then drain again.
    if ((high.length > 0 || low.length > 0) && !timing) {
      timing = true
      void clock.delay((1 - tokens) / refillPerMs).then(() => {
        timing = false
        pump()
      })
    }
  }

  return {
    acquire(priority: Priority = 'low'): Promise<void> {
      return new Promise<void>((resolve) => {
        ;(priority === 'high' ? high : low).push(resolve)
        pump()
      })
    },
  }
}
