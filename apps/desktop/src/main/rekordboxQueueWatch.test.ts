import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { QueueApply } from './rekordboxQueue'
import { stillWaiting, type WatchDeps, watchRekordboxQueue } from './rekordboxQueueWatch'

const APPLIED: QueueApply = {
  status: 'applied',
  tracks: 1,
  changes: 0,
  notices: [],
  written: [],
  outcomes: [],
}

function setup(
  running: boolean[],
  results: QueueApply[] = [APPLIED],
  collection = '/rekordbox/master.db',
) {
  let empty = false
  const deps = {
    queue: {
      isEmpty: () => empty,
      apply: vi.fn<WatchDeps['queue']['apply']>(async (ensureClosed) => {
        const result = results.shift() ?? APPLIED
        if (result.status === 'applied') empty = true
        expect(await ensureClosed()).toBe(true)
        return result
      }),
    },
    collection: () => collection,
    isRunning: vi.fn(async () => running.shift() ?? false),
    onApplied: vi.fn<WatchDeps['onApplied']>(),
  }
  return { deps, setEmpty: (v: boolean) => (empty = v) }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('watchRekordboxQueue', () => {
  it('applies once rekordbox is seen closed, with nobody pressing anything', async () => {
    const { deps } = setup([true, true, false, false])
    const watch = watchRekordboxQueue(deps)
    watch.poke()
    await vi.advanceTimersByTimeAsync(0)
    expect(deps.queue.apply).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(5000)
    expect(deps.queue.apply).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(5000)
    expect(deps.queue.apply).toHaveBeenCalledTimes(1)
    expect(deps.onApplied).toHaveBeenCalledWith(APPLIED)
    watch.stop()
  })

  it('stops polling once the queue is empty because polling costs a process listing every 5 s', async () => {
    const { deps } = setup([false, false])
    const watch = watchRekordboxQueue(deps)
    watch.poke()
    await vi.advanceTimersByTimeAsync(0)
    const checks = deps.isRunning.mock.calls.length
    await vi.advanceTimersByTimeAsync(30000)
    expect(deps.isRunning.mock.calls.length).toBe(checks)
  })

  it('waits for the next close after a failure that is not rekordbox so a full disk does not retry every 5 s', async () => {
    const { deps } = setup(
      [false, false, false, true, false, false],
      [{ status: 'refused', reason: 'backup-failed' }, APPLIED],
    )
    const watch = watchRekordboxQueue(deps)
    watch.poke()
    await vi.advanceTimersByTimeAsync(0)
    expect(deps.onApplied).toHaveBeenCalledWith({ status: 'refused', reason: 'backup-failed' })
    await vi.advanceTimersByTimeAsync(10000)
    expect(deps.queue.apply).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(10000)
    expect(deps.queue.apply).toHaveBeenCalledTimes(2)
    watch.stop()
  })

  it('keeps polling silently when rekordbox reopened between the check and the write', async () => {
    const { deps } = setup(
      [false, false, false, false],
      [{ status: 'refused', reason: 'rekordbox-running' }, APPLIED],
    )
    const watch = watchRekordboxQueue(deps)
    watch.poke()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(5000)
    expect(deps.queue.apply).toHaveBeenCalledTimes(2)
    expect(deps.onApplied).toHaveBeenCalledTimes(1)
    expect(deps.onApplied).toHaveBeenCalledWith(APPLIED)
    watch.stop()
  })

  it('does nothing at startup with an empty queue', async () => {
    const { deps, setEmpty } = setup([])
    setEmpty(true)
    watchRekordboxQueue(deps).poke()
    await vi.advanceTimersByTimeAsync(5000)
    expect(deps.isRunning).not.toHaveBeenCalled()
  })

  it('keeps the queue silently when no rekordbox collection is configured', async () => {
    const { deps } = setup([false, false, false], [APPLIED], '')
    const watch = watchRekordboxQueue(deps)
    watch.poke()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(5000)
    expect(deps.queue.apply).not.toHaveBeenCalled()
    expect(deps.onApplied).not.toHaveBeenCalled()
    watch.stop()
  })

  it('disarms and reports a write failure when apply throws, so a broken write is not retried every 5 s', async () => {
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    const { deps } = setup([false, false, false, true, false, false])
    deps.queue.apply.mockRejectedValueOnce(new Error('disk gone'))
    const watch = watchRekordboxQueue(deps)
    watch.poke()
    await vi.advanceTimersByTimeAsync(0)
    expect(deps.onApplied).toHaveBeenCalledWith({ status: 'refused', reason: 'write-failed' })
    await vi.advanceTimersByTimeAsync(10000)
    expect(deps.queue.apply).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(10000)
    expect(deps.queue.apply).toHaveBeenCalledTimes(2)
    expect(unhandled).not.toHaveBeenCalled()
    process.off('unhandledRejection', unhandled)
    watch.stop()
  })

  it('stays armed and tries again at the next tick when the running check throws', async () => {
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    const { deps } = setup([false, false])
    deps.isRunning.mockRejectedValueOnce(new Error('ps failed'))
    const watch = watchRekordboxQueue(deps)
    watch.poke()
    await vi.advanceTimersByTimeAsync(0)
    expect(deps.queue.apply).not.toHaveBeenCalled()
    expect(deps.onApplied).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(5000)
    expect(deps.queue.apply).toHaveBeenCalledTimes(1)
    expect(deps.onApplied).toHaveBeenCalledWith(APPLIED)
    expect(unhandled).not.toHaveBeenCalled()
    process.off('unhandledRejection', unhandled)
    watch.stop()
  })

  it('reports nothing when the queue turned out to be empty', async () => {
    const { deps } = setup([false, false], [{ status: 'empty' }])
    const watch = watchRekordboxQueue(deps)
    watch.poke()
    await vi.advanceTimersByTimeAsync(0)
    expect(deps.queue.apply).toHaveBeenCalledTimes(1)
    expect(deps.onApplied).not.toHaveBeenCalled()
    watch.stop()
  })
})

describe('stillWaiting', () => {
  it('is true only for work that waits for rekordbox to close', () => {
    expect(stillWaiting({ status: 'refused', reason: 'cancelled' })).toBe(true)
    expect(stillWaiting({ status: 'refused', reason: 'rekordbox-running' })).toBe(true)
    expect(stillWaiting({ status: 'refused', reason: 'backup-failed' })).toBe(false)
    expect(stillWaiting(APPLIED)).toBe(false)
    expect(stillWaiting({ status: 'empty' })).toBe(false)
  })
})
