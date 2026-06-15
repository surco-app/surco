import { describe, expect, it } from 'vitest'
import { createConcurrencyLimiter } from './analysisLimiter'

// A controllable task: it reports when it starts and blocks until released, so a test
// can pin exactly how many ran concurrently and in what order they were served.
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

// Flush the microtask queue so the limiter's just-dispatched tasks have run up to
// their first await before we assert on what started.
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

describe('createConcurrencyLimiter', () => {
  it('runs up to the cap at once and starts a queued task only when a slot frees', async () => {
    // The whole point is to stop a burst of analyses from oversubscribing the cores:
    // with a cap of 2 a third decode must wait for one of the first two to finish.
    const limiter = createConcurrencyLimiter(2)
    const gates = [deferred(), deferred(), deferred()]
    const started = [false, false, false]
    const all = gates.map((g, i) =>
      limiter.run(async () => {
        started[i] = true
        await g.promise
      }),
    )

    await flush()
    expect(started).toEqual([true, true, false])

    gates[0].resolve()
    await flush()
    expect(started).toEqual([true, true, true])

    gates[1].resolve()
    gates[2].resolve()
    await Promise.all(all)
  })

  it('serves a queued high-priority task before low-priority ones already waiting', async () => {
    // The player's waveform (high) is the decode a DJ is actively waiting on, so it
    // must jump ahead of the editor's spectrum/loudness/bpm/key passes (low) that
    // were queued first when every slot was busy.
    const limiter = createConcurrencyLimiter(1)
    const blocker = deferred()
    const order: string[] = []

    const first = limiter.run(async () => {
      order.push('first')
      await blocker.promise
    })
    await flush()

    const low = limiter.run(async () => {
      order.push('low')
    }, 'low')
    const high = limiter.run(async () => {
      order.push('high')
    }, 'high')
    await flush()
    expect(order).toEqual(['first'])

    blocker.resolve()
    await flush()
    expect(order).toEqual(['first', 'high', 'low'])

    await Promise.all([first, low, high])
  })

  it('propagates a task failure to its caller and still frees the slot', async () => {
    // A decode that throws (ffmpeg can't read the file) must reject the caller, not the
    // whole limiter, and must release its slot so the queue keeps draining.
    const limiter = createConcurrencyLimiter(1)
    await expect(limiter.run(async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom')
    await expect(limiter.run(async () => 'ok')).resolves.toBe('ok')
  })
})
