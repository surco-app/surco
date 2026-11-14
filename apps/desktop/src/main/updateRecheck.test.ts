import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { armUpdateRecheck, onlyWhenAutoUpdates, UPDATE_RECHECK_INTERVAL_MS } from './updateRecheck'

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

describe('onlyWhenAutoUpdates', () => {
  // Users who want to stay on their version must not get a newer one downloaded behind
  // their back, at launch or on the periodic re-check.
  it('skips the check while automatic updates are off', () => {
    const check = vi.fn()
    onlyWhenAutoUpdates(() => false, check)()
    expect(check).not.toHaveBeenCalled()
  })

  // The setting is read on every check, so switching it off mid-session stops the next
  // re-check instead of waiting for a relaunch.
  it('follows the setting as it changes', () => {
    const check = vi.fn()
    let enabled = true
    const gated = onlyWhenAutoUpdates(() => enabled, check)
    gated()
    enabled = false
    gated()
    expect(check).toHaveBeenCalledTimes(1)
  })
})
