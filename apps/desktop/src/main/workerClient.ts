import type { TransferListItem, Worker } from 'node:worker_threads'
import type { WorkerJob, WorkerJobResult } from './workerJobs'

interface Pending {
  resolve: (value: WorkerJobResult) => void
  reject: (error: Error) => void
}

interface Queued extends Pending {
  job: WorkerJob
  transfer?: readonly TransferListItem[]
}

interface WorkerResponse {
  id: number
  ok: boolean
  result?: WorkerJobResult
  error?: string
}

export interface WorkerClient {
  run: (job: WorkerJob, transfer?: readonly TransferListItem[]) => Promise<WorkerJobResult>
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
