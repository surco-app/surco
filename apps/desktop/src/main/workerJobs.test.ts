import { describe, expect, it, vi } from 'vitest'
import type { TrackMetadata } from '../shared/types'
import { runWorkerJob } from './workerJobs'

// The dispatcher is the worker-side contract: each job type must reach its real
// implementation with the caller's exact arguments, because a silent mismatch here
// would corrupt files (writeTags) or return analysis for the wrong parameters.
vi.mock('./tempo', () => ({
  detectBpm: vi.fn(() => ({ bpm: 128, confidence: 0.9 })),
  detectBeatgrid: vi.fn(() => ({ bpm: 128, confidence: 0.9, anchorSec: 0.25 })),
}))
vi.mock('./musicalKey', () => ({ detectKey: vi.fn(() => ({ key: 'Am', confidence: 0.8 })) }))
vi.mock('./clickDetect', () => ({ detectClicks: vi.fn(() => [1.5, 3.2]) }))
vi.mock('./waveform', () => ({ computePeaks: vi.fn(() => [0.1, 0.9]) }))
vi.mock('./tags', () => ({ writeTags: vi.fn(), copyCueFrames: vi.fn() }))
vi.mock('./channelScan', () => ({
  runChannelScan: vi.fn(async () => ({ clipped: [false, true], channels: [] })),
}))

import { runChannelScan } from './channelScan'
import { detectClicks } from './clickDetect'
import { detectKey } from './musicalKey'
import { copyCueFrames, writeTags } from './tags'
import { detectBeatgrid, detectBpm } from './tempo'
import { computePeaks } from './waveform'

describe('runWorkerJob', () => {
  it('routes bpm jobs to the tempo detector with the job pcm and rate', () => {
    const pcm = new Float32Array([0.1, 0.2])
    const out = runWorkerJob({ type: 'bpm', pcm, sampleRate: 11025 })
    expect(detectBpm).toHaveBeenCalledWith(pcm, 11025)
    expect(out).toEqual({ bpm: 128, confidence: 0.9 })
  })

  it('routes beatgrid jobs to the anchor detector with the job pcm and rate', () => {
    const pcm = new Float32Array([0.5])
    const out = runWorkerJob({ type: 'beatgrid', pcm, sampleRate: 11025 })
    expect(detectBeatgrid).toHaveBeenCalledWith(pcm, 11025)
    expect(out).toEqual({ bpm: 128, confidence: 0.9, anchorSec: 0.25 })
  })

  it('routes key jobs to the key detector with the job pcm and rate', () => {
    const pcm = new Float32Array([0.3])
    const out = runWorkerJob({ type: 'key', pcm, sampleRate: 11025 })
    expect(detectKey).toHaveBeenCalledWith(pcm, 11025)
    expect(out).toEqual({ key: 'Am', confidence: 0.8 })
  })

  it('routes clicks jobs to the click detector with the job pcm and rate', () => {
    const pcm = new Float32Array([0.1, 0.2, 0.9])
    const out = runWorkerJob({ type: 'clicks', pcm, sampleRate: 44100 })
    expect(detectClicks).toHaveBeenCalledWith(pcm, 44100)
    expect(out).toEqual([1.5, 3.2])
  })

  it('routes waveform peaks to computePeaks with the job pcm and bucket count', () => {
    const pcm = new Float32Array([0.1, 0.2, 0.9])
    const out = runWorkerJob({ type: 'waveformPeaks', pcm, buckets: 2048 })
    expect(computePeaks).toHaveBeenCalledWith(pcm, 2048)
    expect(out).toEqual([0.1, 0.9])
  })

  it('routes tag writes with the full file/meta/cover arguments', () => {
    const meta = { title: 'T' } as TrackMetadata
    runWorkerJob({ type: 'writeTags', file: '/out/a.aiff', meta, coverPath: '/c.jpg' })
    expect(writeTags).toHaveBeenCalledWith(
      '/out/a.aiff',
      meta,
      '/c.jpg',
      undefined,
      undefined,
      undefined,
      undefined,
    )
  })

  it('routes the cue source and shift through tag writes so cues merge into the same save', () => {
    const meta = { title: 'T' } as TrackMetadata
    runWorkerJob({
      type: 'writeTags',
      file: '/out/a.mp3',
      meta,
      cueSource: '/in.mp3',
      cueShift: { shiftMs: 1300 },
    })
    expect(writeTags).toHaveBeenCalledWith(
      '/out/a.mp3',
      meta,
      undefined,
      undefined,
      '/in.mp3',
      { shiftMs: 1300 },
      undefined,
    )
  })

  // The staged grid must reach the same TagLib save as the cues and rating —
  // a missed pass here would ship converted files with no Serato grid.
  it('routes the beatgrid through tag writes', () => {
    const meta = { title: 'T' } as TrackMetadata
    runWorkerJob({
      type: 'writeTags',
      file: '/out/a.mp3',
      meta,
      beatgrid: { bpm: 128, anchorSec: 0.25 },
    })
    expect(writeTags).toHaveBeenCalledWith(
      '/out/a.mp3',
      meta,
      undefined,
      undefined,
      undefined,
      undefined,
      { bpm: 128, anchorSec: 0.25 },
    )
  })

  // The channel scan is the one async job: it spawns ffmpeg and streams the native decode,
  // so it runs here off the main process's event loop. The dispatcher must hand runChannelScan
  // the input, the main-resolved ffmpegPath, the probed channel count and the timeout, and
  // await its result — a mismatch would starve the compare strip of clip marks / lanes.
  it('routes the channel scan to runChannelScan with the ffmpeg path, channels and timeout', async () => {
    const out = await runWorkerJob({
      type: 'channelScan',
      input: '/in.flac',
      ffmpegPath: '/bin/ffmpeg',
      channels: 2,
      timeoutMs: 120000,
    })
    expect(runChannelScan).toHaveBeenCalledWith('/in.flac', '/bin/ffmpeg', 2, 120000)
    expect(out).toEqual({ clipped: [false, true], channels: [] })
  })

  it('routes cue copies with source, destination, shift and beatgrid in order', () => {
    runWorkerJob({
      type: 'copyCueFrames',
      source: '/in.mp3',
      dest: '/out.mp3',
      shift: { shiftMs: 1300, maxMs: 240000 },
      beatgrid: { bpm: 128, anchorSec: 0.25 },
    })
    expect(copyCueFrames).toHaveBeenCalledWith(
      '/in.mp3',
      '/out.mp3',
      { shiftMs: 1300, maxMs: 240000 },
      { bpm: 128, anchorSec: 0.25 },
    )
  })
})
