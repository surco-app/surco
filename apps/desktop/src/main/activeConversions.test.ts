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

  // Quitting the whole app must not leave ffmpeg children orphaned to keep
  // writing after the process that owns them is gone — will-quit calls this for
  // every conversion still in flight.
  it('kills every registered process on killAll and forgets them all', () => {
    const conversions = createActiveConversions()
    const killA = vi.fn()
    const killB = vi.fn()
    conversions.register('a', killA)
    conversions.register('b', killB)
    conversions.killAll()
    expect(killA).toHaveBeenCalledWith('SIGTERM')
    expect(killB).toHaveBeenCalledWith('SIGTERM')
    expect(conversions.cancel('a')).toBe(false)
  })

  it('is a no-op when nothing is running', () => {
    const conversions = createActiveConversions()
    expect(() => conversions.killAll()).not.toThrow()
  })

  // Closing the window mid-batch used to kill the running conversions and drop the
  // queued ones without a word, so the DJ came back to a half-converted crate with no
  // sign of where it stopped. The close handler asks before quitting, and to ask it
  // first has to know whether anything is actually running.
  it('reports how many jobs are still running', () => {
    const conversions = createActiveConversions()
    expect(conversions.count()).toBe(0)
    conversions.beginJob('a')
    conversions.beginJob('b')
    expect(conversions.count()).toBe(2)
    conversions.endJob('a')
    expect(conversions.count()).toBe(1)
    conversions.endJob('b')
    expect(conversions.count()).toBe(0)
  })

  // The count follows jobs, not child processes, because the two differ exactly where
  // it matters: the stream-copy shortcut (same-format retag — the default AIFF path)
  // copies bytes and edits the tag in place without spawning anything. Counting
  // registered children reported 0 for a 300-track retag, so the close guard let the
  // window shut and the queue went with it.
  it('counts a job that never registers a child process', () => {
    const conversions = createActiveConversions()
    conversions.beginJob('copy-only')
    expect(conversions.count()).toBe(1)
    conversions.endJob('copy-only')
    expect(conversions.count()).toBe(0)
  })

  // Killing the child is not the same as the job being over: convertAudio's rejection
  // still has to unwind through processTrack's finally, which is what ends the job.
  // Dropping the count on the kill would reopen the window mid-teardown.
  it('keeps a killed job counted until it actually finishes unwinding', () => {
    const conversions = createActiveConversions()
    conversions.beginJob('a')
    conversions.register('a', vi.fn())
    conversions.cancel('a')
    expect(conversions.count()).toBe(1)
    conversions.killAll()
    expect(conversions.count()).toBe(1)
    conversions.endJob('a')
    expect(conversions.count()).toBe(0)
  })
})
