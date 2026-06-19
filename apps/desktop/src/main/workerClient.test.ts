import { EventEmitter } from 'node:events'
import type { Worker } from 'node:worker_threads'
import { describe, expect, it, vi } from 'vitest'
import { createWorkerClient } from './workerClient'

// A stand-in worker: an EventEmitter with a recorded postMessage, so tests drive
// responses by emitting 'message' and failures by emitting 'error'.
function fakeWorker() {
  const w = new EventEmitter() as EventEmitter & {
    postMessage: ReturnType<typeof vi.fn>
    terminate: ReturnType<typeof vi.fn>
  }
  w.postMessage = vi.fn()
  w.terminate = vi.fn()
  return w
}

const job = { type: 'bpm', pcm: new Float32Array(0), sampleRate: 11025 } as const

describe('createWorkerClient', () => {
  // The worker runs one synchronous DSP pass at a time, so the queue order decides
  // what the user waits for. Newest-first: browsing j/k through a crate stacks up
  // probes for rows already left behind — the track on screen never waits for those.
  it('serves the most recently submitted job first once the worker frees up', async () => {
    const w = fakeWorker()
    const client = createWorkerClient(() => w as unknown as Worker)
    const a = client.run({ ...job, sampleRate: 1 })
    const b = client.run({ ...job, sampleRate: 2 })
    const c = client.run({ ...job, sampleRate: 3 })
    // Only one job is ever posted at a time; the rest wait in the client.
    expect(w.postMessage).toHaveBeenCalledTimes(1)
    expect(w.postMessage.mock.calls[0][0].job.sampleRate).toBe(1)
    w.emit('message', { id: w.postMessage.mock.calls[0][0].id, ok: true, result: 1 })
    await a
    expect(w.postMessage.mock.calls[1][0].job.sampleRate).toBe(3)
    w.emit('message', { id: w.postMessage.mock.calls[1][0].id, ok: true, result: 3 })
    await c
    expect(w.postMessage.mock.calls[2][0].job.sampleRate).toBe(2)
    w.emit('message', { id: w.postMessage.mock.calls[2][0].id, ok: true, result: 2 })
    await b
  })

  // A job that throws inside the worker (unreadable file, bad tag) must fail only
  // its own caller, as a real Error the IPC layer can surface.
  it('rejects the matching caller when the worker reports a job error', async () => {
    const w = fakeWorker()
    const client = createWorkerClient(() => w as unknown as Worker)
    const failing = client.run(job)
    const surviving = client.run(job)
    w.emit('message', { id: w.postMessage.mock.calls[0][0].id, ok: false, error: 'corrupt file' })
    await expect(failing).rejects.toThrow('corrupt file')
    w.emit('message', { id: w.postMessage.mock.calls[1][0].id, ok: true, result: 42 })
    await expect(surviving).resolves.toBe(42)
  })

  // Spawning a thread costs tens of ms; the sweep analyzes hundreds of tracks, so
  // the client must spawn once and reuse the same worker for every job.
  it('spawns the worker once and reuses it across jobs', async () => {
    const w = fakeWorker()
    const spawn = vi.fn(() => w as unknown as Worker)
    const client = createWorkerClient(spawn)
    const a = client.run(job)
    const b = client.run(job)
    w.emit('message', { id: w.postMessage.mock.calls[0][0].id, ok: true, result: 1 })
    w.emit('message', { id: w.postMessage.mock.calls[1][0].id, ok: true, result: 2 })
    await Promise.all([a, b])
    expect(spawn).toHaveBeenCalledTimes(1)
  })

  // If the thread itself dies (OOM, crash in native code), everything in flight
  // must reject — not hang forever — and the next job gets a fresh worker.
  it('fails in-flight jobs when the worker dies and respawns for the next job', async () => {
    const first = fakeWorker()
    const second = fakeWorker()
    const spawn = vi
      .fn()
      .mockReturnValueOnce(first as unknown as Worker)
      .mockReturnValueOnce(second as unknown as Worker)
    const client = createWorkerClient(spawn)
    const doomed = client.run(job)
    first.emit('error', new Error('worker crashed'))
    await expect(doomed).rejects.toThrow('worker crashed')
    const revived = client.run(job)
    second.emit('message', { id: second.postMessage.mock.calls[0][0].id, ok: true, result: 'ok' })
    await expect(revived).resolves.toBe('ok')
    expect(spawn).toHaveBeenCalledTimes(2)
  })

  // A worker that emits 'error' without exiting leaves its OS thread alive. The
  // client must terminate it before respawning, or a session of crashes leaks one
  // thread per failure.
  it('terminates the dead worker so a respawn never leaks the thread', async () => {
    const first = fakeWorker()
    const second = fakeWorker()
    const spawn = vi
      .fn()
      .mockReturnValueOnce(first as unknown as Worker)
      .mockReturnValueOnce(second as unknown as Worker)
    const client = createWorkerClient(spawn)
    const doomed = client.run(job)
    first.emit('error', new Error('worker crashed'))
    await expect(doomed).rejects.toThrow('worker crashed')
    expect(first.terminate).toHaveBeenCalledTimes(1)
  })

  // Jobs still waiting in the client when the thread dies must reject like the
  // in-flight one — a queued promise that never settles would hang its caller.
  it('rejects queued jobs too when the worker dies', async () => {
    const w = fakeWorker()
    const client = createWorkerClient(() => w as unknown as Worker)
    const inFlight = client.run(job)
    const queued = client.run(job)
    expect(w.postMessage).toHaveBeenCalledTimes(1)
    w.emit('error', new Error('worker crashed'))
    await expect(inFlight).rejects.toThrow('worker crashed')
    await expect(queued).rejects.toThrow('worker crashed')
  })
})
