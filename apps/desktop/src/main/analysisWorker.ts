import { parentPort } from 'node:worker_threads'
import { runWorkerJob, type WorkerJob } from './workerJobs'

// Worker-thread entry: a plain request/response loop over parentPort. All routing
// logic lives in runWorkerJob so it stays testable outside a thread.
parentPort?.on('message', ({ id, job }: { id: number; job: WorkerJob }) => {
  try {
    parentPort?.postMessage({ id, ok: true, result: runWorkerJob(job) })
  } catch (e) {
    parentPort?.postMessage({ id, ok: false, error: e instanceof Error ? e.message : String(e) })
  }
})
