import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))
vi.mock('./analysisCache', () => ({
  LOUDNESS_NAMESPACE: 'loudness',
  cachedAnalysis: (_namespace: string, _input: string, run: () => Promise<unknown>) => run(),
}))
const jobs: unknown[] = []
vi.mock('./worker', async () => {
  const { runWorkerJob } = await import('./workerJobs')
  return {
    runInWorker: async (job: unknown) => {
      jobs.push(job)
      return runWorkerJob(job as Parameters<typeof runWorkerJob>[0])
    },
  }
})

import { readMeta } from './ffmpeg'

describe('readMeta and TagLib', () => {
  it('asks the worker for the TagLib fields, so a slow NAS file never freezes the app', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'surco-rmworker-')), 'a.mp3')
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
      file,
    ])
    const read = await readMeta(file)
    expect(jobs).toContainEqual({ type: 'tagLibRead', file })
    expect(read.tags.grouping).toBe('Peak Time')
  })
})
