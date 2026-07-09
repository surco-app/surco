import { describe, expect, it, vi } from 'vitest'
import { createActiveConversions } from './activeConversions'

describe('createActiveConversions', () => {
  // cancelBatch only breaks the renderer's between-track loop today: an
  // already-running ffmpeg keeps writing until it finishes, so a stalled network
  // mount leaves the whole batch — and the Cancel button — stuck. This registry is
  // what lets a cancel reach the process actually running.
  it('kills the registered process for a job and forgets it', () => {
    const conversions = createActiveConversions()
    const kill = vi.fn()
    conversions.register('job1', kill)
    expect(conversions.cancel('job1')).toBe(true)
    expect(kill).toHaveBeenCalledWith('SIGTERM')
  })

  it('is a no-op for a job with no process registered (already finished, or never had one)', () => {
    const conversions = createActiveConversions()
    expect(conversions.cancel('missing')).toBe(false)
  })

  it('forgets a job once unregistered, so a late cancel after completion is a no-op', () => {
    const conversions = createActiveConversions()
    const kill = vi.fn()
    conversions.register('job1', kill)
    conversions.unregister('job1')
    expect(conversions.cancel('job1')).toBe(false)
    expect(kill).not.toHaveBeenCalled()
  })

  // A cancelled job's finally-block still calls unregister on its way out; that
  // must not throw or evict a different job that reused the same id slot.
  it('tolerates unregistering a job that was already cancelled', () => {
    const conversions = createActiveConversions()
    const kill = vi.fn()
    conversions.register('job1', kill)
    conversions.cancel('job1')
    expect(() => conversions.unregister('job1')).not.toThrow()
  })
})
