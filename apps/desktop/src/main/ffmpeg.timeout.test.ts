import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))

// Capture every spawn so we can assert the analysis reads carry a kill-timeout.
const calls: Array<{ file: string; args: string[]; opts: { timeout?: number } | undefined }> = []

vi.mock('node:child_process', () => ({
  execFile: (
    file: string,
    args: string[],
    opts: { timeout?: number } | undefined,
    cb: (err: unknown, out: { stdout: string; stderr: string }) => void,
  ) => {
    calls.push({ file, args, opts })
    cb(null, { stdout: '{"streams":[{}],"format":{}}', stderr: '' })
  },
}))

import {
  analyzeCutoff,
  measureBpm,
  measureKey,
  measureLoudness,
  measureWaveform,
  probeAudio,
  probeDuration,
  probeProperties,
  readTags,
} from './ffmpeg'

beforeEach(() => {
  calls.length = 0
})

// A stalled network mount (an SMB share that goes unresponsive) makes an ffmpeg/ffprobe
// read block forever. Without a timeout the analysis limiter slot — and the renderer's
// quality sweep slot waiting on it — never frees, so the whole "Analizar calidad" sweep
// freezes mid-run while CPU drops to idle. Every analysis read must be killable so a hung
// file is dropped and the sweep moves on. Conversions are NOT covered here on purpose:
// they can legitimately run for minutes, so they keep their unbounded behavior.
describe('analysis ffmpeg reads are bounded by a kill-timeout', () => {
  const swallow = (p: Promise<unknown>): Promise<unknown> => p.catch(() => undefined)

  it('passes a positive timeout to every analysis read', async () => {
    // Each of these reads the (possibly networked) source file, so each can stall.
    await swallow(probeDuration('/in.flac'))
    await swallow(readTags('/in.flac'))
    await swallow(probeAudio('/in.flac'))
    await swallow(probeProperties('/in.flac'))
    await swallow(measureLoudness('/in.flac'))
    await swallow(measureBpm('/in.flac'))
    await swallow(measureKey('/in.flac'))
    await swallow(measureWaveform('/in.flac'))
    await swallow(analyzeCutoff('/in.flac', 44100))

    expect(calls.length).toBeGreaterThan(0)
    for (const call of calls) {
      expect(call.opts?.timeout, `${call.args.join(' ')} ran without a timeout`).toBeGreaterThan(0)
    }
  })
})
