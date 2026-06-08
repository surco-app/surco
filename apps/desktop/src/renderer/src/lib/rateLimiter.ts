export interface RateLimiter {
  // Resolves once a token is free. Callers must await it before making the rate-limited call.
  acquire: () => Promise<void>
}

// The bit of wall-clock the limiter needs, injected so tests can drive virtual time.
export interface RateClock {
  now: () => number
  delay: (ms: number) => Promise<void>
}

const realClock: RateClock = {
  now: () => Date.now(),
  delay: (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms))),
}

// Token bucket: starts full with `capacity` tokens and refills continuously at
// `capacity` tokens per `windowMs`. acquire() hands out a token immediately while the
// bucket has one — so a small drop's worth of requests never wait — and otherwise stalls
// the caller until the next token accrues, holding the sustained rate at the cap. Discogs
// allows ~60 requests/min and a folder drop can fan a crate's worth of searches at it, so
// every auto-match request takes a token first. Acquires are chained so concurrent probes
// reserve tokens one at a time rather than all racing the same empty bucket.
export function createRateLimiter(
  capacity: number,
  windowMs: number,
  clock: RateClock = realClock,
): RateLimiter {
  const refillPerMs = capacity / windowMs
  let tokens = capacity
  let last = clock.now()
  let tail: Promise<unknown> = Promise.resolve()

  function refill(): void {
    const t = clock.now()
    tokens = Math.min(capacity, tokens + (t - last) * refillPerMs)
    last = t
  }

  async function reserve(): Promise<void> {
    refill()
    if (tokens < 1) {
      await clock.delay((1 - tokens) / refillPerMs)
      refill()
    }
    tokens -= 1
  }

  return {
    acquire(): Promise<void> {
      const next = tail.then(reserve)
      // Keep the chain alive even if a waiter rejects, so one failure doesn't wedge the bucket.
      tail = next.catch(() => undefined)
      return next
    },
  }
}
