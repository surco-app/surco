import { describe, expect, it } from 'vitest'
import { createRateLimiter } from './rateLimiter'

// A clock the test drives by hand: now() reads virtual time and delay() fast-forwards it,
// so a token bucket's pacing is asserted deterministically without real timers.
function virtualClock() {
  let t = 0
  return {
    now: () => t,
    delay: (ms: number) => {
      t += Math.max(0, ms)
      return Promise.resolve()
    },
    advance: (ms: number) => {
      t += ms
    },
    elapsed: () => t,
  }
}

describe('createRateLimiter', () => {
  // A fresh bucket is full, so a small drop's worth of requests must not be paced at all —
  // throttling only kicks in once the burst has spent the capacity.
  it('lets a full bucket through without making anyone wait', async () => {
    const clock = virtualClock()
    const limiter = createRateLimiter(3, 3000, clock)
    await limiter.acquire()
    await limiter.acquire()
    await limiter.acquire()
    expect(clock.elapsed()).toBe(0)
  })

  // Once empty, the next request waits exactly one refill interval (window / capacity), the
  // spacing that holds the sustained rate at the cap.
  it('spaces requests out once the bucket is empty', async () => {
    const clock = virtualClock()
    const limiter = createRateLimiter(3, 3000, clock)
    await limiter.acquire()
    await limiter.acquire()
    await limiter.acquire()
    await limiter.acquire()
    expect(clock.elapsed()).toBe(1000)
  })

  // The guarantee that matters for Discogs' ~60/min: across a burst far larger than the
  // bucket, the total time grows so the rate never exceeds capacity-per-window.
  it('never exceeds the cap over a sustained burst', async () => {
    const clock = virtualClock()
    const limiter = createRateLimiter(3, 3000, clock)
    for (let i = 0; i < 9; i++) await limiter.acquire()
    // 3 free at t=0, then one every 1000ms: the 9th lands at 6000.
    expect(clock.elapsed()).toBe(6000)
  })

  // Concurrent callers (the sweep runs several probes at once) must still be served one token
  // at a time, in order — not all let through because they raced the same empty bucket.
  it('serializes concurrent acquires against one shared bucket', async () => {
    const clock = virtualClock()
    const limiter = createRateLimiter(2, 2000, clock)
    await Promise.all([limiter.acquire(), limiter.acquire(), limiter.acquire()])
    expect(clock.elapsed()).toBe(1000)
  })

  // Idle time refills the bucket, so a request after a quiet spell is instant again.
  it('refills as time passes', async () => {
    const clock = virtualClock()
    const limiter = createRateLimiter(3, 3000, clock)
    await limiter.acquire()
    await limiter.acquire()
    await limiter.acquire()
    clock.advance(3000)
    await limiter.acquire()
    expect(clock.elapsed()).toBe(3000)
  })
})
