import type {
  Beatgrid,
  BeatgridResult,
  BpmResult,
  KeyResult,
  TrackMetadata,
  WaveformScan,
} from '../shared/types'
import { runChannelScan } from './channelScan'
import { prependFlacId3 } from './flacFinderCover'
import { bandEnergiesDb } from './hfShelf'
import { detectKey } from './musicalKey'
import { copyCueFrames, type CueShift, writeTags } from './tags'
import { detectBeatgrid, detectBpm } from './tempo'

// The CPU-bound work that must never run on the main process's event loop: the
// BPM/key DSP crunches hundreds of FFTs per track, and TagLib rewrites a whole
// 100MB+ AIFF synchronously when it grows the ID3 header. Each job is plain
// structured-cloneable data so it can cross a worker_threads boundary.
export type WorkerJob =
  | { type: 'bpm'; pcm: Float32Array; sampleRate: number }
  | { type: 'beatgrid'; pcm: Float32Array; sampleRate: number }
  | { type: 'key'; pcm: Float32Array; sampleRate: number }
  | { type: 'shelf'; pcm: Float32Array; sampleRate: number }
  | {
      type: 'writeTags'
      file: string
      meta: TrackMetadata
      coverPath?: string
      removeCover?: boolean
      // Carries this file's cue frames over in the same TagLib save, sparing
      // the separate copyCueFrames rewrite (see tags.ts). cueShift re-anchors
      // them when a trim moved the audio underneath.
      cueSource?: string
      cueShift?: CueShift
      // The staged beatgrid in output-file time, written as Serato's GEOB.
      beatgrid?: Beatgrid
    }
  | { type: 'copyCueFrames'; source: string; dest: string; shift?: CueShift; beatgrid?: Beatgrid }
  // The Finder-covers ID3 prepend rewrites the whole FLAC synchronously, so it runs
  // off the main process's event loop like the other TagLib passes.
  | { type: 'prependFlacId3'; file: string; meta: TrackMetadata; coverPath: string }
  // The native-rate clip/channel scan: spawns ffmpeg and streams ~32M samples through a
  // per-block reducer. ffmpegPath and channels ride the job as data because the worker has
  // no `app`/binaries to resolve them; running it here keeps that reduction off the main
  // process's event loop (the one worker job that is async — it awaits the decode).
  | { type: 'channelScan'; input: string; ffmpegPath: string; channels: number; timeoutMs: number }

export type WorkerJobResult =
  | BpmResult
  | BeatgridResult
  | KeyResult
  | number[]
  | WaveformScan
  | null

export function runWorkerJob(job: WorkerJob): WorkerJobResult | Promise<WorkerJobResult> {
  switch (job.type) {
    case 'channelScan':
      return runChannelScan(job.input, job.ffmpegPath, job.channels, job.timeoutMs)
    case 'bpm':
      return detectBpm(job.pcm, job.sampleRate)
    case 'beatgrid':
      return detectBeatgrid(job.pcm, job.sampleRate)
    case 'key':
      return detectKey(job.pcm, job.sampleRate)
    case 'shelf':
      return bandEnergiesDb(job.pcm, job.sampleRate)
    case 'writeTags':
      writeTags(
        job.file,
        job.meta,
        job.coverPath,
        job.removeCover,
        job.cueSource,
        job.cueShift,
        job.beatgrid,
      )
      return null
    case 'copyCueFrames':
      copyCueFrames(job.source, job.dest, job.shift, job.beatgrid)
      return null
    case 'prependFlacId3':
      prependFlacId3(job.file, job.meta, job.coverPath)
      return null
  }
}
