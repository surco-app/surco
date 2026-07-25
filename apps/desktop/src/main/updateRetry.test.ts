import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createUpdateRetry, UPDATE_RETRY_DELAYS_MS } from './updateRetry'

describe('createUpdateRetry', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  // A minutes-long GitHub blip used to cost a full 2h recheck cycle: the fast
  // backoff exists so the update lands minutes after the feed recovers.
  it('retries with the 1/5/15 minute backoff', () => {
    const retry = vi.fn()
    const scheduler = createUpdateRetry(retry, vi.fn())
    scheduler.onFailure('transient', 504)
    vi.advanceTimersByTime(UPDATE_RETRY_DELAYS_MS[0])
    expect(retry).toHaveBeenCalledTimes(1)
    scheduler.onFailure('transient', 504)
    vi.advanceTimersByTime(UPDATE_RETRY_DELAYS_MS[1])
    expect(retry).toHaveBeenCalledTimes(2)
    scheduler.onFailure('transient', 504)
    vi.advanceTimersByTime(UPDATE_RETRY_DELAYS_MS[2])
    expect(retry).toHaveBeenCalledTimes(3)
  })

  // The user agreed to hear about an outage only once it survives the whole backoff
  // (4 consecutive failures, ~20 min) — and only once per incident, so an
  // afternoon-long GitHub outage doesn't re-toast on every 2h recheck.
  it('notifies once on the 4th consecutive failure and stays quiet after', () => {
    const notify = vi.fn()
    const scheduler = createUpdateRetry(vi.fn(), notify)
    scheduler.onFailure('transient', 504)
    scheduler.onFailure('transient', 504)
    scheduler.onFailure('transient', 504)
    expect(notify).not.toHaveBeenCalled()
    scheduler.onFailure('transient', 502)
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith(502)
    scheduler.onFailure('transient', 502)
    expect(notify).toHaveBeenCalledTimes(1)
  })

  // Working offline is not an incident: the retry loop keeps trying but the user
  // is never told their (absent) connection failed to reach GitHub.
  it('never notifies for offline failures', () => {
    const notify = vi.fn()
    const scheduler = createUpdateRetry(vi.fn(), notify)
    for (let i = 0; i < 6; i++) scheduler.onFailure('offline', null)
    expect(notify).not.toHaveBeenCalled()
  })

  // Mixed outage: the backoff burnt out while offline, then the network comes back
  // to a real GitHub error — that first non-offline failure must still notify.
  it('notifies the first transient failure past the backoff even after offline ones', () => {
    const notify = vi.fn()
    const scheduler = createUpdateRetry(vi.fn(), notify)
    for (let i = 0; i < 4; i++) scheduler.onFailure('offline', null)
    expect(notify).not.toHaveBeenCalled()
    scheduler.onFailure('transient', 504)
    expect(notify).toHaveBeenCalledWith(504)
  })

  // A success must fully re-arm the machinery: counter back to zero (next incident
  // gets the fast backoff again), pending retry cancelled (no stray double-check),
  // notify re-armed (next incident toasts again).
  it('resets the counter, cancels the pending retry and re-arms notify on success', () => {
    const retry = vi.fn()
    const notify = vi.fn()
    const scheduler = createUpdateRetry(retry, notify)
    scheduler.onFailure('transient', 504)
    scheduler.onSuccess()
    vi.advanceTimersByTime(UPDATE_RETRY_DELAYS_MS[2] * 10)
    expect(retry).not.toHaveBeenCalled()

    for (let i = 0; i < 4; i++) scheduler.onFailure('transient', 504)
    expect(notify).toHaveBeenCalledTimes(1)
    scheduler.onSuccess()
    for (let i = 0; i < 4; i++) scheduler.onFailure('transient', 500)
    expect(notify).toHaveBeenCalledTimes(2)
    expect(notify).toHaveBeenLastCalledWith(500)
  })

  // The 2h recheck can fail while a backoff retry is already pending; stacking a
  // second timer would double the check traffic and skew the failure count.
  it('replaces a pending retry instead of stacking timers', () => {
    const retry = vi.fn()
    const scheduler = createUpdateRetry(retry, vi.fn())
    scheduler.onFailure('transient', 504)
    scheduler.onFailure('transient', 504)
    vi.advanceTimersByTime(UPDATE_RETRY_DELAYS_MS[0] + UPDATE_RETRY_DELAYS_MS[1])
    expect(retry).toHaveBeenCalledTimes(1)
  })
})
