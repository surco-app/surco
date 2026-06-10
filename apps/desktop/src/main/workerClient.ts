import type { TransferListItem, Worker } from 'node:worker_threads'
import type { WorkerJob, WorkerJobResult } from './workerJobs'

interface Pending {
  resolve: (value: WorkerJobResult) => void
  reject: (error: Error) => void
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
// tens of ms, while the analyze sweep submits hundreds of jobs per session. If the
// thread itself dies, every in-flight job rejects (never hangs) and the next job
// spawns a fresh worker.
export function createWorkerClient(spawn: () => Worker): WorkerClient {
  let worker: Worker | null = null
  let nextId = 0
  const pending = new Map<number, Pending>()

  function ensureWorker(): Worker {
    if (worker) return worker
    const spawned = spawn()
    spawned.on('message', (response: WorkerResponse) => {
      const job = pending.get(response.id)
      if (!job) return
      pending.delete(response.id)
      if (response.ok) job.resolve(response.result ?? null)
      else job.reject(new Error(response.error ?? 'worker job failed'))
    })
    spawned.on('error', (error: Error) => {
      for (const job of pending.values()) job.reject(error)
      pending.clear()
      worker = null
    })
    worker = spawned
    return spawned
  }

  return {
    run(job, transfer) {
      const w = ensureWorker()
      const id = nextId++
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject })
        w.postMessage({ id, job }, transfer)
      })
    },
  }
}
