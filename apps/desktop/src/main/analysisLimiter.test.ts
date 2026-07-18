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

  it('serves an urgent task before high-priority ones already waiting', async () => {
    // Selecting a track queues several 'high' passes (spectrum, shelf, loudness) for the
    // same file, so the waveform — the one decode a DJ who just hit play is staring at —
    // used to wait behind them even though it was also 'high'. 'urgent' lets only the
    // waveform jump the whole high lane, not just the low one.
    const limiter = createConcurrencyLimiter(1)
    const blocker = deferred()
    const order: string[] = []

    const first = limiter.run(async () => {
      order.push('first')
      await blocker.promise
    })
    await flush()

    const high = limiter.run(async () => {
      order.push('high')
    }, 'high')
    const urgent = limiter.run(async () => {
      order.push('urgent')
    }, 'urgent')
    await flush()
    expect(order).toEqual(['first'])

    blocker.resolve()
    await flush()
    expect(order).toEqual(['first', 'urgent', 'high'])

    await Promise.all([first, high, urgent])
  })

  it('propagates a task failure to its caller and still frees the slot', async () => {
    // A decode that throws (ffmpeg can't read the file) must reject the caller, not the
    // whole limiter, and must release its slot so the queue keeps draining.
    const limiter = createConcurrencyLimiter(1)
    await expect(limiter.run(async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom')
    await expect(limiter.run(async () => 'ok')).resolves.toBe('ok')
  })

  it('drops a queued task whose signal aborts before it gets a slot', async () => {
    // The point of cancellation: browsing tracks quickly queues analyses for rows the
    // user already left. Those must never spend a slot decoding audio nobody will look
    // at — an abort while waiting rejects immediately and the slot goes to live work.
    const limiter = createConcurrencyLimiter(1)
    const blocker = deferred()
    const first = limiter.run(async () => {
      await blocker.promise
    })
    await flush()

    const controller = new AbortController()
    let ran = false
    const queued = limiter.run(
      async () => {
        ran = true
      },
      'high',
      controller.signal,
    )
    controller.abort()

    await expect(queued).rejects.toMatchObject({ name: 'AbortError' })
    blocker.resolve()
    await first
    await flush()
    expect(ran).toBe(false)
  })

  it('rejects a task whose signal is already aborted without ever starting it', async () => {
    // Selecting away can abort before the IPC even reaches the limiter; the request
    // must not start a decode whose result is already unwanted.
    const limiter = createConcurrencyLimiter(1)
    const controller = new AbortController()
    controller.abort()
    let ran = false
    await expect(
      limiter.run(
        async () => {
          ran = true
        },
        'high',
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(ran).toBe(false)
  })

  it('frees the slot of an aborted queued task for the next waiter', async () => {
    // An aborted waiter must leave no ghost in the queue: the task queued behind it
    // still gets served the moment the running one finishes.
    const limiter = createConcurrencyLimiter(1)
    const blocker = deferred()
    const first = limiter.run(async () => {
      await blocker.promise
    })
    await flush()

    const controller = new AbortController()
    const aborted = limiter.run(async () => {}, 'high', controller.signal)
    let laterRan = false
    const later = limiter.run(async () => {
      laterRan = true
    }, 'high')
    controller.abort()
    await expect(aborted).rejects.toMatchObject({ name: 'AbortError' })

    blocker.resolve()
    await first
    await flush()
    expect(laterRan).toBe(true)
    await later
  })

  it('leaves a running task untouched when its signal aborts mid-flight', async () => {
    // Killing the underlying ffmpeg child is the task's own job (execFile's signal
    // support); the limiter only guarantees the slot is accounted for until the task
    // settles, however that happens.
    const limiter = createConcurrencyLimiter(1)
    const controller = new AbortController()
    const gate = deferred()
    let finished = false
    const running = limiter.run(
      async () => {
        await gate.promise
        finished = true
      },
      'high',
      controller.signal,
    )
    await flush()
    controller.abort()
    gate.resolve()
    await running
    expect(finished).toBe(true)
  })
})
