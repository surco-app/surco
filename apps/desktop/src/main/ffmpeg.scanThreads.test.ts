import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

vi.mock('node:child_process', () => ({
  execFile: (
    _file: string,
    _args: string[],
    _opts: unknown,
    cb: (err: unknown, out: { stdout: string; stderr: string }) => void,
  ) => {
    cb(null, {
      stdout: JSON.stringify({ streams: [{ channels: 2, sample_rate: '44100' }] }),
      stderr: '',
    })
  },
  spawn: vi.fn(),
}))

const jobs: Array<Record<string, unknown>> = []
vi.mock('./worker', () => ({
  runInWorker: async (job: Record<string, unknown>) => {
    jobs.push(job)
    return { clipped: [], channels: [], mono: { peaks: [], rms: [] }, frames: 0 }
  },
  signalWorkers: vi.fn(),
}))

import { inAnalysisLane } from './analysisLane'
import { measureChannelScan } from './ffmpeg'

describe('channel scan threading', () => {
  it('asks the worker for a single-thread decode when the scan runs in the background lane', async () => {
    jobs.length = 0
    await inAnalysisLane('low', () => measureChannelScan('/bg.flac'))

    expect(jobs.find((j) => j.type === 'channelScan')?.singleThread).toBe(true)
  })

  it('lets the scan for the track on screen use every decoder thread', async () => {
    jobs.length = 0
    await inAnalysisLane('high', () => measureChannelScan('/fg.flac'))

    expect(jobs.find((j) => j.type === 'channelScan')?.singleThread).toBe(false)
  })
})
