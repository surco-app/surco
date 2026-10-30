import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

const jobs: string[] = []
let hang: (type: string) => boolean = () => false
vi.mock('./worker', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./worker')>()
  const { runWorkerJob } = await import('./workerJobs')
  return {
    ...actual,
    runInWorker: async (job: import('./workerJobs').WorkerJob) => {
      jobs.push(job.type)
      if (hang(job.type)) return new Promise(() => {})
      return runWorkerJob(job)
    },
  }
})

import { errorKeyOf } from '../shared/errorKeys'
import { emptyMetadata } from '../shared/metadata'
import { writeTags } from './tags'
import { checkFile, type FileExpect, fileReaders } from './verifyFile'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-verifytagreads-'))
const m4a = join(dir, 'tagged.m4a')

const expectation: FileExpect = {
  path: m4a,
  ext: '.m4a',
  codec: 'copy',
  samplesKept: false,
  sourceDurationSec: 2,
  trimmedSec: 0,
  tags: { title: 'T', trackNumber: '3', bpm: '124' },
  cover: 'untouched',
}

beforeAll(() => {
  execFileSync(FF, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=d=2', '-c:a', 'alac', m4a])
  writeTags(m4a, { ...emptyMetadata(), title: 'T', trackNumber: '3', bpm: '124' })
})

beforeEach(() => {
  jobs.length = 0
  hang = () => false
})

// TagLib parses the whole tag synchronously: on the main process a slow share stalls the
// UI for every track a batch checks.
describe('checkFile — tag reads', () => {
  it('reads the tags, the cover and the M4A numbers in the worker', async () => {
    const check = await checkFile(expectation, fileReaders)
    expect(check.state, JSON.stringify(check.detail)).toBe('ok')
    expect(jobs).toEqual(expect.arrayContaining(['tagSnapshot', 'verifyTagExtras']))
  })

  it.each(['tagSnapshot', 'verifyTagExtras'])(
    'a %s that never answers is stopped by the job cancel',
    async (type) => {
      hang = (t) => t === type
      const controller = new AbortController()
      setTimeout(() => controller.abort(), 50)
      const failure = await checkFile(expectation, fileReaders, {
        signal: controller.signal,
      }).catch((e: unknown) => e)
      expect(errorKeyOf((failure as Error).message)).toBe('conversionCancelled')
    },
  )

  it.each(['snapshotTags', 'tagExtras'] as const)(
    'a %s read that never answers gives up at its bound',
    async (reader) => {
      hang = () => true
      await expect(fileReaders[reader](m4a, { timeoutMs: 20 })).rejects.toThrow()
    },
  )
})
