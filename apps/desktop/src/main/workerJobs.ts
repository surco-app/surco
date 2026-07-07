import type { BpmResult, KeyResult, TrackMetadata } from '../shared/types'
import { bandEnergiesDb } from './hfShelf'
import { detectKey } from './musicalKey'
import { copyCueFrames, writeTags } from './tags'
import { detectBpm } from './tempo'

// The CPU-bound work that must never run on the main process's event loop: the
// BPM/key DSP crunches hundreds of FFTs per track, and TagLib rewrites a whole
// 100MB+ AIFF synchronously when it grows the ID3 header. Each job is plain
// structured-cloneable data so it can cross a worker_threads boundary.
export type WorkerJob =
  | { type: 'bpm'; pcm: Float32Array; sampleRate: number }
  | { type: 'key'; pcm: Float32Array; sampleRate: number }
  | { type: 'shelf'; pcm: Float32Array; sampleRate: number }
  | {
      type: 'writeTags'
      file: string
      meta: TrackMetadata
      coverPath?: string
      removeCover?: boolean
      // Carries this file's GEOB cue frames over in the same TagLib save,
      // sparing the separate copyCueFrames rewrite (see tags.ts).
      cueSource?: string
    }
  | { type: 'copyCueFrames'; source: string; dest: string }

export type WorkerJobResult = BpmResult | KeyResult | number[] | null

export function runWorkerJob(job: WorkerJob): WorkerJobResult {
  switch (job.type) {
    case 'bpm':
      return detectBpm(job.pcm, job.sampleRate)
    case 'key':
      return detectKey(job.pcm, job.sampleRate)
    case 'shelf':
      return bandEnergiesDb(job.pcm, job.sampleRate)
    case 'writeTags':
      writeTags(job.file, job.meta, job.coverPath, job.removeCover, job.cueSource)
      return null
    case 'copyCueFrames':
      copyCueFrames(job.source, job.dest)
      return null
  }
}
