import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import type { TrackMetadata } from '../shared/types'
import { convertAudio } from './ffmpeg'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-tmpclean-'))
const src = join(dir, 'in.flac')

const meta: TrackMetadata = {
  title: 'T',
  artist: 'A',
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
  execFileSync(FF, [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=1',
    '-c:a',
    'flac',
    src,
  ])
})

describe('the temp a failed conversion leaves behind', () => {
  // A conversion that dies before writing anything leaves no temp, so the delete fails
  // with ENOENT. That is not litter: flagging it would put a path in the sweep manifest
  // that names a file which does not exist, and every later launch would chase it.
  it('is not reported as surviving when it was never written', async () => {
    let tmpPath = ''
    // An unwritable destination directory fails the encode before ffmpeg produces output.
    const out = join(dir, 'no-such-dir', 'out.flac')
    const err = await convertAudio(
      src,
      out,
      'flac',
      meta,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      (p) => {
        tmpPath = p
      },
    ).catch((e: unknown) => e)

    expect(tmpPath).not.toBe('')
    expect(existsSync(tmpPath)).toBe(false)
    expect((err as { tmpSurvived?: boolean }).tmpSurvived).toBeUndefined()
  })
})
