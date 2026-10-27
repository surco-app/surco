import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { describe, expect, it, vi } from 'vitest'

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

import { snapshotTagsInWorker } from './tagChanges'
import { snapshotTags } from './tagSnapshot'

// Every conversion snapshots the tags before and after for the activity panel. TagLib
// parses the whole tag synchronously, so on main a slow NAS file froze the UI twice per
// track; the snapshot rides the worker and must come back exactly as the inline read did.
describe('snapshotTagsInWorker', () => {
  it('reads the snapshot in the worker, identical to the inline one', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'surco-snapworker-')), 'a.mp3')
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
      'title=Long One',
      '-metadata',
      'grouping=Peak Time',
      file,
    ])
    const snapshot = await snapshotTagsInWorker(file)
    expect(jobs).toContainEqual({ type: 'tagSnapshot', file })
    expect(snapshot).toEqual(snapshotTags(file))
    expect(snapshot?.length).toBeGreaterThan(0)
  })

  it('answers null for a file TagLib cannot open, as the inline snapshot did', async () => {
    expect(await snapshotTagsInWorker('/no/such.mp3')).toBeNull()
  })
})
