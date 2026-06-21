import { EventEmitter } from 'node:events'
import type { Worker } from 'node:worker_threads'
import { describe, expect, it, vi } from 'vitest'
import { createWorkerPool } from './workerClient'

// Same stand-in as workerClient.test: an EventEmitter with a recorded postMessage.
function fakeWorker() {
  const w = new EventEmitter() as EventEmitter & {
    postMessage: ReturnType<typeof vi.fn>
    terminate: ReturnType<typeof vi.fn>
  }
  w.postMessage = vi.fn()
  w.terminate = vi.fn()
  return w
}

// Drain the microtask queue so the pool's settle-then-dispatch (run on a finally
// continuation, not synchronously like the single client's pump) has run before
// the next assertion.
const flush = () => new Promise((r) => setImmediate(r))

const job = { type: 'bpm', pcm: new Float32Array(0), sampleRate: 11025 } as const
const reply = (w: ReturnType<typeof fakeWorker>, call: number, result: unknown) =>
  w.emit('message', { id: w.postMessage.mock.calls[call][0].id, ok: true, result })

describe('createWorkerPool', () => {
  // The whole point of the pool: two tracks' DSP run on two threads at once instead
  // of queueing behind a single worker, so a folder sweep finishes in cores-parallel
  // time rather than serially.
  it('runs jobs on separate workers concurrently', async () => {
    const workers = [fakeWorker(), fakeWorker()]
    let i = 0
    const spawn = vi.fn(() => workers[i++] as unknown as Worker)
    const pool = createWorkerPool(spawn, 2)

    const a = pool.run({ ...job, sampleRate: 1 })
    const b = pool.run({ ...job, sampleRate: 2 })
    await flush()

    // Both are in flight at the same time, one per worker — not serialized.
    expect(workers[0].postMessage).toHaveBeenCalledTimes(1)
    expect(workers[1].postMessage).toHaveBeenCalledTimes(1)
    expect(spawn).toHaveBeenCalledTimes(2)

    reply(workers[0], 0, 1)
    reply(workers[1], 0, 2)
    expect(await a).toBe(1)
    expect(await b).toBe(2)
  })

  // When every worker is busy the overflow waits, and the newest submission jumps the
  // queue — the on-screen track a DJ just landed on never waits behind rows they
  // already scrolled past, exactly as the single client guarantees.
  it('queues overflow newest-first once every worker is busy', async () => {
    const workers = [fakeWorker(), fakeWorker()]
    let i = 0
    const pool = createWorkerPool(() => workers[i++] as unknown as Worker, 2)

    const a = pool.run({ ...job, sampleRate: 1 })
    pool.run({ ...job, sampleRate: 2 })
    pool.run({ ...job, sampleRate: 3 })
    pool.run({ ...job, sampleRate: 4 })
    await flush()

    // Two run immediately; sampleRate 3 and 4 wait.
    expect(workers[0].postMessage).toHaveBeenCalledTimes(1)
    expect(workers[1].postMessage).toHaveBeenCalledTimes(1)

    // Free worker 0 → the newest queued job (sampleRate 4) is served next.
    reply(workers[0], 0, 1)
    await a
    await flush()
    expect(workers[0].postMessage.mock.calls[1][0].job.sampleRate).toBe(4)
  })

  // One worker crashing rejects only its own caller; the other worker keeps serving,
  // so a single bad decode can't stall the whole sweep.
  it('keeps the other workers serving when one dies', async () => {
    const workers = [fakeWorker(), fakeWorker()]
    let i = 0
    const pool = createWorkerPool(() => workers[i++] as unknown as Worker, 2)

    const doomed = pool.run({ ...job, sampleRate: 1 })
    const surviving = pool.run({ ...job, sampleRate: 2 })
    await flush()

    workers[0].emit('error', new Error('worker crashed'))
    await expect(doomed).rejects.toThrow('worker crashed')

    reply(workers[1], 0, 99)
    expect(await surviving).toBe(99)
  })

  // A single-slot pool (the 4-core budget, floor(4/4)=1) must behave exactly like the
  // current single client so small machines see no concurrency change.
  it('degrades to the single client at size 1', async () => {
    const w = fakeWorker()
    const spawn = vi.fn(() => w as unknown as Worker)
    const pool = createWorkerPool(spawn, 1)

    pool.run({ ...job, sampleRate: 1 })
    pool.run({ ...job, sampleRate: 2 })
    await flush()

    // One at a time, like the single worker.
    expect(w.postMessage).toHaveBeenCalledTimes(1)
    expect(spawn).toHaveBeenCalledTimes(1)
  })
})
