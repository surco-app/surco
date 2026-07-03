import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { armUpdateRecheck, UPDATE_RECHECK_INTERVAL_MS } from './updateRecheck'

describe('armUpdateRecheck', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  // The launch-time probe used to be the only one, so a release shipped after launch
  // (patches often follow their minor within the hour) was never noticed until the
  // next relaunch. The re-check must KEEP firing, not run once.
  it('re-checks on every interval for as long as the app runs', () => {
    const check = vi.fn()
    armUpdateRecheck(check)
    expect(check).not.toHaveBeenCalled()
    vi.advanceTimersByTime(UPDATE_RECHECK_INTERVAL_MS)
    expect(check).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(UPDATE_RECHECK_INTERVAL_MS * 2)
    expect(check).toHaveBeenCalledTimes(3)
  })

  it('stops re-checking once disarmed', () => {
    const check = vi.fn()
    const disarm = armUpdateRecheck(check)
    disarm()
    vi.advanceTimersByTime(UPDATE_RECHECK_INTERVAL_MS * 3)
    expect(check).not.toHaveBeenCalled()
  })
})
