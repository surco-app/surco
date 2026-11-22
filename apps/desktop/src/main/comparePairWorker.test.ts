import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { beforeAll, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))
vi.mock('./worker', async (original) => ({
  ...(await original()),
  runInWorker: vi.fn(async () => {
    throw new Error('worker gone')
  }),
}))

import type { PairFacts } from '../shared/types'
import { comparePair } from './ffmpeg'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-pair-worker-'))
const base = join(dir, 'base.wav')
const tail = join(dir, 'tail.wav')

beforeAll(() => {
  const q = ['-v', 'error', '-y']
  execFileSync(FF, [
    ...q,
    '-f',
    'lavfi',
    '-i',
    'anoisesrc=d=20:c=pink:seed=5:a=0.3',
    '-c:a',
    'pcm_s16le',
    base,
  ])
  execFileSync(FF, [...q, '-i', base, '-af', 'apad=pad_dur=5', '-c:a', 'pcm_s16le', tail])
})

// A wider search that fails says nothing about another version; the ±1 s probe's facts still
// stand, so the copies can still be judged on them.
it('keeps the probe facts when the wider search fails', async () => {
  const p = (await comparePair(base, tail, true)) as PairFacts | null
  expect(p?.correlation).toBeGreaterThan(0.99)
  expect(p?.versionCorrelation).toBeUndefined()
})
