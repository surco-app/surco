import { parentPort } from 'node:worker_threads'
import { killActiveScans } from './channelScan'
import { runWorkerJob, type WorkerJob } from './workerJobs'

// The channel scan spawns ffmpeg from in here, so a child outlives this thread unless it
// is killed on the way out: quitting Surco mid-scan otherwise leaves a native decode of a
// long mix burning a core with nothing left that can stop it. 'exit' covers both routes
// the thread ends by — the pool terminating it, and the process going away underneath.
process.on('exit', killActiveScans)

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
