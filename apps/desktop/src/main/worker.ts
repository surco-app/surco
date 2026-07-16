import os from 'node:os'
import type { Transferable } from 'node:worker_threads'
import { createWorkerPool, type WorkerClient } from './workerClient'
import type { WorkerJob, WorkerJobResult } from './workerJobs'

let clientPromise: Promise<WorkerClient | null> | null = null

// How many DSP worker threads run in parallel. A quarter of the logical cores (min
// one): the analysis ffmpeg decodes already claim up to half the cores through
// analysisLimiter, and DSP runs right after each decode, so a quarter leaves the
// machine room for ffmpeg, the audio element and the UI rather than oversubscribing
// every core. Derived per machine from the core count — a 4-core laptop gets 1 (the
// pre-pool single worker), a 16-core desktop gets 4. SURCO_DSP_WORKERS overrides it
// for diagnosing a specific machine without a settings knob the user can't reason about.
function poolSize(): number {
  const override = Number(process.env.SURCO_DSP_WORKERS)
  if (Number.isInteger(override) && override >= 1) return override
  return Math.max(1, Math.floor(os.cpus().length / 4))
}

// The ?nodeWorker import is dynamic so plain Node tooling (vitest) never has to
// apply the electron-vite-only module transform; the bundler still sees a literal
// specifier and emits the worker chunk. Outside the bundle the module arrives
// without its factory default — getClient resolves null there and jobs run inline,
// which is exactly the pre-worker behavior the integration tests exercise.
function getClient(): Promise<WorkerClient | null> {
  clientPromise ??= import('./analysisWorker?nodeWorker').then((mod) =>
    typeof mod.default === 'function'
      ? createWorkerPool(() => mod.default({}), poolSize())
      : null,
  )
  return clientPromise
}

// The production seam behind measureBpm/measureKey and the conversion tag passes:
// ships the CPU-bound job to the reused worker thread so the main process event
// loop (IPC, menu, surco:// streaming) never stalls behind DSP or TagLib rewrites.
export async function runInWorker<T extends WorkerJobResult>(
  job: WorkerJob,
  transfer?: readonly Transferable[],
): Promise<T> {
  const client = await getClient()
  if (!client) return (await import('./workerJobs')).runWorkerJob(job) as T
  return (await client.run(job, transfer)) as T
}
