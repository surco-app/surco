import type { TransferListItem } from 'node:worker_threads'
import { createWorkerClient, type WorkerClient } from './workerClient'
import type { WorkerJob, WorkerJobResult } from './workerJobs'

let clientPromise: Promise<WorkerClient | null> | null = null

// The ?nodeWorker import is dynamic so plain Node tooling (vitest) never has to
// apply the electron-vite-only module transform; the bundler still sees a literal
// specifier and emits the worker chunk. Outside the bundle the module arrives
// without its factory default — getClient resolves null there and jobs run inline,
// which is exactly the pre-worker behavior the integration tests exercise.
function getClient(): Promise<WorkerClient | null> {
  clientPromise ??= import('./analysisWorker?nodeWorker').then((mod) =>
    typeof mod.default === 'function' ? createWorkerClient(() => mod.default({})) : null,
  )
  return clientPromise
}

// The production seam behind measureBpm/measureKey and the conversion tag passes:
// ships the CPU-bound job to the reused worker thread so the main process event
// loop (IPC, menu, surco:// streaming) never stalls behind DSP or TagLib rewrites.
export async function runInWorker<T extends WorkerJobResult>(
  job: WorkerJob,
  transfer?: readonly TransferListItem[],
): Promise<T> {
  const client = await getClient()
  if (!client) return (await import('./workerJobs')).runWorkerJob(job) as T
  return (await client.run(job, transfer)) as T
}
