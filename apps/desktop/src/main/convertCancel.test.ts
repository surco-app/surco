import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))

import type { TrackMetadata } from '../shared/types'
import { convertAudio } from './ffmpeg'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-cancel-'))
const src = join(dir, 'in.wav')

const meta: TrackMetadata = {
  title: 'Long One',
  artist: 'Test',
  album: '',
  albumArtist: '',
  year: '',
  genre: '',
  grouping: '',
  comment: '',
  trackNumber: '',
  discNumber: '',
  bpm: '',
  key: '',
  publisher: '',
  catalogNumber: '',
  remixArtist: '',
}

beforeAll(() => {
  // Long enough that killing the child mid-encode is reliably still in flight —
  // a stalled network mount is what this simulates, not a slow one.
  execFileSync(FF, [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=20',
    '-ar',
    '44100',
    '-ac',
    '2',
    src,
  ])
})

// Without a way to reach the child, cancelBatch only stops tracks not yet
// started — an already-running conversion (the one most likely to be the stuck
// one, on a dying network mount) keeps going forever. onChild is what a caller
// uses to kill it, mirroring what activeConversions.cancel() does in production.
describe('convertAudio — killed mid-encode', () => {
  it('rejects and leaves no .tmp file behind when the child is killed', async () => {
    const out = join(dir, 'killed.flac')
    const promise = convertAudio(
      src,
      out,
      'flac',
      meta,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      (child) => child.kill('SIGTERM'),
    )

    await expect(promise).rejects.toThrow()
    const leftovers = readdirSync(dir).filter((f) => f.includes('.tmp-'))
    expect(leftovers).toEqual([])
  }, 15000)
})
