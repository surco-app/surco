import type {
  BpmResult,
  KeyResult,
  TrackMetadata,
  WaveformScan,
} from '../shared/types'
import { runChannelScan } from './channelScan'
import { detectClicks } from './clickDetect'
import { prependFlacId3 } from './flacFinderCover'
import { bandEnergiesDb } from './hfShelf'
import { detectKey } from './musicalKey'
import { copyCueFrames, type CueShift, writeTags } from './tags'
import { detectBpm } from './tempo'
import { computePeaks } from './waveform'

// The CPU-bound work that must never run on the main process's event loop: the
// BPM/key DSP crunches hundreds of FFTs per track, and TagLib rewrites a whole
// 100MB+ AIFF synchronously when it grows the ID3 header. Each job is plain
// structured-cloneable data so it can cross a worker_threads boundary.
export type WorkerJob =
  | { type: 'bpm'; pcm: Float32Array; sampleRate: number }
  | { type: 'key'; pcm: Float32Array; sampleRate: number }
  | { type: 'shelf'; pcm: Float32Array; sampleRate: number }
  // The click detector's second-difference scan over the whole native-rate side (~21M
  // samples): one O(n) pass, but big enough to jank the surco:// audition it fires during,
  // so it runs here like the other reductions rather than on the main event loop.
  | { type: 'clicks'; pcm: Float32Array; sampleRate: number }
  // The waveform envelope's max-abs reduction to peak buckets. Runs on every play and most
  // section opens (priority 'high'), so keeping its full-length walk off the main event loop
  // matters most of all — it fires right as surco:// starts streaming. buckets defaults to
  // the overview grid; the deep-zoom window passes its own.
  | { type: 'waveformPeaks'; pcm: Float32Array; buckets?: number }
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
    }
  | { type: 'copyCueFrames'; source: string; dest: string; shift?: CueShift }
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
  | KeyResult
  | number[]
  | { peaks: number[]; rms: number[] }
  | WaveformScan
  | null

export function runWorkerJob(job: WorkerJob): WorkerJobResult | Promise<WorkerJobResult> {
  switch (job.type) {
    case 'channelScan':
      return runChannelScan(job.input, job.ffmpegPath, job.channels, job.timeoutMs)
    case 'bpm':
      return detectBpm(job.pcm, job.sampleRate)
    case 'key':
      return detectKey(job.pcm, job.sampleRate)
    case 'shelf':
      return bandEnergiesDb(job.pcm, job.sampleRate)
    case 'clicks':
      return detectClicks(job.pcm, job.sampleRate)
    case 'waveformPeaks':
      return computePeaks(job.pcm, job.buckets)
    case 'writeTags':
      writeTags(job.file, job.meta, job.coverPath, job.removeCover, job.cueSource, job.cueShift)
      return null
    case 'copyCueFrames':
      copyCueFrames(job.source, job.dest, job.shift)
      return null
    case 'prependFlacId3':
      prependFlacId3(job.file, job.meta, job.coverPath)
      return null
  }
}
