import type { Transferable, Worker } from 'node:worker_threads'
import type { WorkerJob, WorkerJobResult } from './workerJobs'

interface Pending {
  resolve: (value: WorkerJobResult) => void
  reject: (error: Error) => void
}

interface Queued extends Pending {
  job: WorkerJob
  transfer?: readonly Transferable[]
}

interface WorkerResponse {
  id: number
  ok: boolean
  result?: WorkerJobResult
  error?: string
}

export interface WorkerClient {
  run: (job: WorkerJob, transfer?: readonly Transferable[]) => Promise<WorkerJobResult>
}

// Correlates jobs to responses over a single reused worker: spawning a thread costs
// tens of ms, while a session submits hundreds of jobs. Jobs are held client-side and
// posted one at a time, newest first — the worker runs one synchronous DSP pass at a
// time anyway, and browsing j/k through a crate stacks up probes for rows already
// left behind, which the track on screen must never wait for. If the thread itself
// dies, every in-flight and queued job rejects (never hangs) and the next job spawns
// a fresh worker.
export function createWorkerClient(spawn: () => Worker): WorkerClient {
  let worker: Worker | null = null
  let nextId = 0
  let inFlightId: number | null = null
  const pending = new Map<number, Pending>()
  const queue: Queued[] = []

  function failEverything(error: Error): void {
    for (const job of pending.values()) job.reject(error)
    pending.clear()
    for (const queued of queue.splice(0)) queued.reject(error)
    inFlightId = null
    // An 'error' can fire on a thread that hasn't exited; terminate it so the
    // respawn never leaves the dead worker's OS thread alive.
    worker?.terminate()
    worker = null
  }

  function ensureWorker(): Worker {
    if (worker) return worker
    const spawned = spawn()
    spawned.on('message', (response: WorkerResponse) => {
      const job = pending.get(response.id)
      if (!job) return
      pending.delete(response.id)
      if (response.id === inFlightId) inFlightId = null
      if (response.ok) job.resolve(response.result ?? null)
      else job.reject(new Error(response.error ?? 'worker job failed'))
      pump()
    })
    spawned.on('error', failEverything)
    worker = spawned
    return spawned
  }

  function pump(): void {
    if (inFlightId !== null) return
    // LIFO: the most recent submission is what the user is looking at right now.
    const next = queue.pop()
    if (!next) return
    const w = ensureWorker()
    const id = nextId++
    inFlightId = id
    pending.set(id, next)
    w.postMessage({ id, job: next.job }, next.transfer)
  }

  return {
    run(job, transfer) {
      return new Promise((resolve, reject) => {
        queue.push({ job, transfer, resolve, reject })
        pump()
      })
    },
  }
}

// A fixed set of single-worker clients sharing one newest-first queue: the DSP a
// folder sweep stacks up (bpm/key/shelf per track) ran serially through one worker
// while every other core sat idle, so a hundred tracks crunched one at a time. The
// pool dispatches each waiting job to whichever worker is free, running up to `size`
// in parallel. Each slot reuses createWorkerClient untouched — its lazy spawn (no
// thread until a job lands), reuse and respawn-on-death — and because a slot is only
// handed a job while idle, the client's own queue never holds more than its one
// in-flight job; the LIFO ordering lives here at the pool level instead. size <= 1
// returns the bare client so a small machine sees the exact pre-pool behavior.
export function createWorkerPool(spawn: () => Worker, size: number): WorkerClient {
  if (size <= 1) return createWorkerClient(spawn)
  const slots = Array.from({ length: size }, () => ({
    client: createWorkerClient(spawn),
    busy: false,
  }))
  const queue: Queued[] = []

  function dispatch(): void {
    if (queue.length === 0) return
    const slot = slots.find((s) => !s.busy)
    if (!slot) return
    // LIFO: the most recent submission is what the user is looking at right now.
    const next = queue.pop() as Queued
    slot.busy = true
    slot.client
      .run(next.job, next.transfer)
      .then(next.resolve, next.reject)
      // Free the slot whether the job resolved or the worker died, then pull the
      // next waiter — one crashed decode must never strand its worker as busy.
      .finally(() => {
        slot.busy = false
        dispatch()
      })
  }

  return {
    run(job, transfer) {
      return new Promise((resolve, reject) => {
        queue.push({ job, transfer, resolve, reject })
        dispatch()
      })
    },
  }
}
