import { parentPort } from 'node:worker_threads'
import { runWorkerJob, type WorkerJob } from './workerJobs'

// Worker-thread entry: a plain request/response loop over parentPort. All routing
// logic lives in runWorkerJob so it stays testable outside a thread. The await handles
// both the synchronous DSP jobs (which return a value straight through) and the channel
// scan (which returns a promise while it spawns ffmpeg and streams the native decode) —
// so the scan's ~32M-sample reduction runs here, off the main process's event loop.
parentPort?.on('message', async ({ id, job }: { id: number; job: WorkerJob }) => {
  try {
    parentPort?.postMessage({ id, ok: true, result: await runWorkerJob(job) })
  } catch (e) {
    parentPort?.postMessage({ id, ok: false, error: e instanceof Error ? e.message : String(e) })
  }
})
