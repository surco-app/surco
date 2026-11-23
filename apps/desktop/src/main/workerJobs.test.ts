import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { describe, expect, it, vi } from 'vitest'
import type { TrackMetadata } from '../shared/types'
import { runWorkerJob } from './workerJobs'

// The dispatcher is the worker-side contract: each job type must reach its real
// implementation with the caller's exact arguments, because a silent mismatch here
// would corrupt files (writeTags) or return analysis for the wrong parameters.
vi.mock('./tempo', () => ({
  detectBpm: vi.fn(() => ({ bpm: 128, confidence: 0.9 })),
}))
vi.mock('./musicalKey', () => ({ detectKey: vi.fn(() => ({ key: 'Am', confidence: 0.8 })) }))
vi.mock('./beatGrid', () => ({
  fitBeatGrid: vi.fn(() => ({
    bpm: 128,
    firstMs: 3,
    fine: Array.from({ length: 60 }, () => ({ ms: 0, firstMs: 3 })),
  })),
  auditGrid: vi.fn(() => ({ windows: [{ ms: 9000, offsetMs: 1 }], total: 4 })),
}))
vi.mock('./clickDetect', () => ({ detectClicks: vi.fn(() => [1.5, 3.2]) }))
vi.mock('./waveform', () => ({ computePeaks: vi.fn(() => [0.1, 0.9]) }))
vi.mock('./tags', async (importActual) => ({
  ...(await importActual<typeof import('./tags')>()),
  writeTags: vi.fn(),
  copyCueFrames: vi.fn(),
}))
vi.mock('./tagFieldSet', () => ({ setTagFields: vi.fn(() => ['written']) }))
vi.mock('./channelScan', () => ({
  runChannelScan: vi.fn(async () => ({ clipped: [false, true], channels: [] })),
}))

vi.mock('../shared/autoCue', () => ({
  autoCue: { tuneDropTaste: vi.fn(() => null) },
}))

vi.mock('./cueWaveWords', () => ({
  runCueWaveWords: vi.fn(async () => new Uint16Array([1, 2, 3])),
}))

import { autoCue } from '../shared/autoCue'
import { auditGrid } from './beatGrid'
import { runChannelScan } from './channelScan'
import { detectClicks } from './clickDetect'
import { runCueWaveWords } from './cueWaveWords'
import { detectKey } from './musicalKey'
import { setTagFields } from './tagFieldSet'
import { copyCueFrames, type TagLibRead, writeTags } from './tags'
import { detectBpm } from './tempo'
import { computePeaks } from './waveform'

describe('runWorkerJob', () => {
  it('routes tuneDrops jobs to the taste tuner, which can take seconds and must stay off the main loop', () => {
    const tracks = [{ key: 'a', candidates: [{ bar: 0, features: [1] }], drops: [0] }]
    const out = runWorkerJob({ type: 'tuneDrops', tracks })
    expect(autoCue.tuneDropTaste).toHaveBeenCalledWith(tracks)
    expect(out).toBeNull()
  })

  // The wider version search's FFT reaches 2^19 points; measured 58 to 293 ms on the main
  // loop, so it runs here. Same samples with a reversed polarity 3 s later still match.
  it('runs the wider version search off the main loop, matching either polarity', () => {
    const rate = 4410
    const a = new Float32Array(40 * rate)
    let seed = 7
    for (let i = 0; i < a.length; i++) {
      seed = (seed * 16807) % 2147483647
      a[i] = seed / 2147483647 - 0.5
    }
    const b = new Float32Array(43 * rate)
    for (let i = 0; i < a.length; i++) b[i + 3 * rate] = -a[i]
    const out = runWorkerJob({ type: 'versionMatch', a, b, reachSec: 4 })
    expect(out).toBeGreaterThan(0.99)
  })

  it('routes bpm jobs to the tempo detector with the job pcm and rate', () => {
    const pcm = new Float32Array([0.1, 0.2])
    const out = runWorkerJob({ type: 'bpm', pcm, sampleRate: 11025 })
    expect(detectBpm).toHaveBeenCalledWith(pcm, 11025)
    expect(out).toEqual({ bpm: 128, confidence: 0.9 })
  })

  it('measures a grid and fits the beat from one decode when no fit is kept yet', () => {
    const pcm = new Float32Array(100 * 120)
    const out = runWorkerJob({
      type: 'gridAudit',
      pcm,
      sampleRate: 100,
      beats: [0, 500],
      leadMs: 51,
      withFit: true,
    })
    expect(auditGrid).toHaveBeenCalledWith(pcm, 100, [0, 500], 51)
    expect(out).toEqual({
      windows: [{ ms: 9000, offsetMs: 1 }],
      total: 4,
      minutes: 2,
      fit: expect.objectContaining({ bpm: 128 }),
    })
  })

  it('skips the fit when one is kept, so moving the grid in the editor stays quick', () => {
    const out = runWorkerJob({
      type: 'gridAudit',
      pcm: new Float32Array(11025 * 60),
      sampleRate: 11025,
      beats: [0, 500],
      leadMs: 0,
      withFit: false,
    })
    expect(out).toMatchObject({ fit: null, minutes: 1 })
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

  it('routes field writes to setTagFields with the file and the changes', () => {
    const changes = [{ field: 'artist' as const, from: 'Dj Lara', to: 'DJ Lara' }]
    const out = runWorkerJob({ type: 'setTagFields', file: '/out/a.mp3', changes })
    expect(setTagFields).toHaveBeenCalledWith('/out/a.mp3', changes)
    expect(out).toEqual(['written'])
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
      undefined,
    )
  })

  it('routes the clearExtras flag through so a cleared record wipes its rating', () => {
    const meta = { title: '' } as TrackMetadata
    runWorkerJob({
      type: 'writeTags',
      file: '/out/a.mp3',
      meta,
      removeCover: true,
      clearExtras: true,
    })
    expect(writeTags).toHaveBeenCalledWith(
      '/out/a.mp3',
      meta,
      undefined,
      true,
      undefined,
      undefined,
      true,
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
      undefined,
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
    expect(runChannelScan).toHaveBeenCalledWith('/in.flac', '/bin/ffmpeg', 2, 120000, false)
    expect(out).toEqual({ clipped: [false, true], channels: [] })
  })

  it('decodes the colour wave words in the worker with the file rate, so a batch of Engine tracks never stalls the window', async () => {
    const out = await runWorkerJob({
      type: 'cueWaveWords',
      input: '/in.aiff',
      ffmpegPath: '/bin/ffmpeg',
      sampleRate: 44100,
      timeoutMs: 120000,
    })
    expect(runCueWaveWords).toHaveBeenCalledWith('/in.aiff', '/bin/ffmpeg', 44100, 120000)
    expect(out).toEqual(new Uint16Array([1, 2, 3]))
  })

  it('routes cue copies with source, destination and shift in order', () => {
    runWorkerJob({
      type: 'copyCueFrames',
      source: '/in.mp3',
      dest: '/out.mp3',
      shift: { shiftMs: 1300, maxMs: 240000 },
    })
    expect(copyCueFrames).toHaveBeenCalledWith('/in.mp3', '/out.mp3', {
      shiftMs: 1300,
      maxMs: 240000,
    })
  })
})

describe('tagLibRead', () => {
  it('reads every TagLib field readMeta needs in one job, off the main process', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'surco-tlread-')), 'a.mp3')
    execFileSync(ffmpegStatic as unknown as string, [
      '-y',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=1',
      '-c:a',
      'libmp3lame',
      '-metadata',
      'grouping=Peak Time',
      '-metadata',
      'album=Bright Days ',
      file,
    ])
    const read = (await runWorkerJob({ type: 'tagLibRead', file })) as TagLibRead
    expect(read.grouping).toBe('Peak Time')
    expect(read.reviewRaw.album).toBe('Bright Days ')
    expect(read.popm).toBe('')
  }, 30000)

  it('answers empty fields for a file TagLib cannot open, as the inline read did', async () => {
    const read = (await runWorkerJob({ type: 'tagLibRead', file: '/no/such.mp3' })) as TagLibRead
    expect(read).toEqual({ grouping: '', extras: {}, popm: '', reviewRaw: {} })
  })
})
