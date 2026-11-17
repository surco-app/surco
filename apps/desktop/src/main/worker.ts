import os from 'node:os'
import type { Transferable, Worker } from 'node:worker_threads'
import type { AmbiguousMatch, FindOptions, RekordboxTrack } from './rekordboxDb'
import {
  emptyRekordboxRead,
  type RekordboxReadAnswer,
  type RekordboxReadArg,
  type RekordboxReadName,
  trackOfCollection,
} from './rekordboxReads'
import { type ThreadLogMessage, threadLog } from './threadLog'
import {
  emptyTraktorRead,
  type TraktorReadAnswer,
  type TraktorReadArg,
  type TraktorReadName,
} from './traktorReads'
import { createWorkerClient, createWorkerPool, type WorkerClient } from './workerClient'
import type { WorkerJob, WorkerJobResult } from './workerJobs'

function logging(worker: Worker): Worker {
  worker.on('message', (message: Partial<ThreadLogMessage>) => {
    if (message.log) threadLog[message.log[0]](message.log[1])
  })
  return worker
}

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
      ? createWorkerPool(() => logging(mod.default({})), poolSize())
      : null,
  )
  return clientPromise
}

let collectionClient: Promise<WorkerClient | null> | null = null

function getCollectionClient(): Promise<WorkerClient | null> {
  collectionClient ??= import('./analysisWorker?nodeWorker').then((mod) =>
    typeof mod.default === 'function' ? createWorkerClient(() => logging(mod.default({}))) : null,
  )
  return collectionClient
}

export async function readRekordbox<N extends RekordboxReadName>(
  path: string,
  key: string | undefined,
  name: N,
  arg: RekordboxReadArg<N>,
): Promise<RekordboxReadAnswer<N>> {
  if (!path) return emptyRekordboxRead(name)
  const job: WorkerJob = { type: 'rekordboxRead', path, key, name, arg }
  const client = await getCollectionClient()
  const answer = client
    ? await client.run(job)
    : await (await import('./workerJobs')).runWorkerJob(job)
  return answer as unknown as RekordboxReadAnswer<N>
}

export async function readTraktor<N extends TraktorReadName>(
  file: string,
  bootVolume: string,
  name: N,
  arg: TraktorReadArg<N>,
): Promise<TraktorReadAnswer<N>> {
  if (!file) return emptyTraktorRead(name)
  const job: WorkerJob = { type: 'traktorRead', file, bootVolume, name, arg }
  const client = await getCollectionClient()
  const answer = client
    ? await client.run(job)
    : await (await import('./workerJobs')).runWorkerJob(job)
  return answer as unknown as TraktorReadAnswer<N>
}

export async function findRekordboxTrack(
  collection: string,
  key: string | undefined,
  file: string,
  options: FindOptions,
): Promise<RekordboxTrack | AmbiguousMatch | null> {
  if (!(await getCollectionClient())) return trackOfCollection(collection, key, file, options)
  return readRekordbox(collection, key, 'track', {
    file,
    resolve: options.realPath !== undefined,
    homeMusicDir: options.homeMusicDir,
    quiet: options.quiet,
  })
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

// Delivers a control job (a scan kill) to every live worker at once, skipping the job
// queue, and drops the queued jobs `drop` matches. Inline (no worker) it just runs here.
export async function signalWorkers(
  job: WorkerJob,
  drop: (queued: WorkerJob) => boolean,
): Promise<void> {
  const client = await getClient()
  if (!client) {
    ;(await import('./workerJobs')).runWorkerJob(job)
    return
  }
  client.dropQueued(drop)
  client.broadcast(job)
}
