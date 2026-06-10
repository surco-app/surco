import { EventEmitter } from 'node:events'
import type { Worker } from 'node:worker_threads'
import { describe, expect, it, vi } from 'vitest'
import { createWorkerClient } from './workerClient'

// A stand-in worker: an EventEmitter with a recorded postMessage, so tests drive
// responses by emitting 'message' and failures by emitting 'error'.
function fakeWorker() {
  const w = new EventEmitter() as EventEmitter & { postMessage: ReturnType<typeof vi.fn> }
  w.postMessage = vi.fn()
  return w
}

const job = { type: 'bpm', pcm: new Float32Array(0), sampleRate: 11025 } as const

describe('createWorkerClient', () => {
  // Two analyses can be in flight at once (the background sweep runs bpm and key per
  // track); each caller must get its own result back even when the worker answers
  // out of order — correlation is the whole point of the id.
  it('correlates out-of-order responses to their callers', async () => {
    const w = fakeWorker()
    const client = createWorkerClient(() => w as unknown as Worker)
    const first = client.run(job)
    const second = client.run(job)
    const [{ id: firstId }] = w.postMessage.mock.calls[0]
    const [{ id: secondId }] = w.postMessage.mock.calls[1]
    w.emit('message', { id: secondId, ok: true, result: 'second' })
    w.emit('message', { id: firstId, ok: true, result: 'first' })
    await expect(second).resolves.toBe('second')
    await expect(first).resolves.toBe('first')
  })

  // A job that throws inside the worker (unreadable file, bad tag) must fail only
  // its own caller, as a real Error the IPC layer can surface.
  it('rejects the matching caller when the worker reports a job error', async () => {
    const w = fakeWorker()
    const client = createWorkerClient(() => w as unknown as Worker)
    const failing = client.run(job)
    const surviving = client.run(job)
    const [{ id: failId }] = w.postMessage.mock.calls[0]
    const [{ id: okId }] = w.postMessage.mock.calls[1]
    w.emit('message', { id: failId, ok: false, error: 'corrupt file' })
    w.emit('message', { id: okId, ok: true, result: 42 })
    await expect(failing).rejects.toThrow('corrupt file')
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
})
