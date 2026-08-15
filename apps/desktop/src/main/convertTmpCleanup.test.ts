import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import { rename } from 'node:fs/promises'
import type { TrackMetadata } from '../shared/types'
import { convertAudio } from './ffmpeg'
import { renameWithRetry, rescuePath } from './renameRetry'

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

  // The rescue's whole purpose: a destination that will not accept the rename must not
  // cost the user a conversion whose audio, tags and cues are already written. Real
  // files, real rescue — a held destination cannot be staged on macOS (POSIX renames
  // over open files), so the lock is simulated by refusing the destination and letting
  // everything else, including the sibling rename, run for real.
  it('leaves the rescued conversion on disk instead of deleting it', async () => {
    const from = join(dir, 'finished.tmp')
    const to = join(dir, 'held.flac')
    writeFileSync(from, 'a finished conversion')

    // Resolved BEFORE the rescue runs: rescuePath disambiguates against what is already
    // on disk, so asking again afterwards would name the next free slot, not the file
    // that just landed.
    const rescued = rescuePath(to)
    const attempts: string[] = []
    await renameWithRetry(from, to, {
      rename: async (a, b) => {
        attempts.push(b)
        if (b === to) throw Object.assign(new Error('EPERM: held'), { code: 'EPERM' })
        await rename(a, b)
      },
      sleep: async () => {},
      rescue: rescuePath,
    }).catch(() => {})
    // Proves the rescue was actually reached, so a green assertion below cannot come
    // from the retries simply never running out.
    expect(attempts.at(-1)).toBe(rescued)

    // The work is under its sibling name, and the temp is gone because it MOVED there.
    expect(existsSync(rescued)).toBe(true)
    expect(existsSync(from)).toBe(false)
  })
})
