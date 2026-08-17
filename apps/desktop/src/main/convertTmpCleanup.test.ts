import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { platform, tmpdir } from 'node:os'
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

  // The case the two tests above cannot reach: a temp that is still on disk after the
  // cleanup tried to remove it. Both of them only ever hit ENOENT — one kills the
  // encode before ffmpeg writes anything, the other moves the temp away — so the
  // surviving branch, and with it the tmpSurvived flag processTrack reads to keep the
  // path in the sweep manifest, went unexercised. Without that flag the half-written
  // file sits in the user's music folder with nothing recording it, which is what the
  // NAS reports looked like.
  //
  // Reproduced with real errors rather than a stubbed unlink: the temp is made
  // immutable the moment it appears on disk, so the rename that follows fails, the
  // rescue beside it fails too, and the cleanup's unlink comes back EPERM instead of
  // ENOENT. macOS-only (chflags), skipped elsewhere rather than faked.
  //
  // Known to be occasionally flaky under a loaded full-suite run, and not reproducible
  // on demand (it survived eleven consecutive full runs while being chased). It leans
  // on two pieces of real time — how long ffmpeg takes to create the temp, and the
  // rename's ~3.1s retry window — so the poll below and the timeout at the end are both
  // generous. If it fails again, the thing to check is whether `locked` was ever set:
  // an empty one means the poll gave up before ffmpeg wrote the file, which is a slow
  // machine rather than a broken guarantee.
  it.skipIf(platform() !== 'darwin')(
    'flags the temp as surviving when the cleanup cannot delete it',
    async () => {
      const outDir = join(dir, 'held')
      mkdirSync(outDir)
      let tmpPath = ''
      let locked = ''
      // onTmp fires when the path is chosen, before ffmpeg writes it, so the flag has
      // to wait for the file to exist. The window is generous on purpose: a two-second
      // budget was enough alone and ran out under a full-suite run competing for CPU,
      // which failed the assertions below for a reason that had nothing to do with what
      // they test. It ends as soon as the file appears, so the slack costs nothing.
      const lockWhenWritten = async (p: string): Promise<void> => {
        for (let i = 0; i < 1000 && !locked; i++) {
          if (existsSync(p)) {
            execFileSync('chflags', ['uchg', p])
            locked = p
            return
          }
          await new Promise((r) => setTimeout(r, 10))
        }
      }

      let err: unknown
      try {
        const out = join(outDir, 'out.flac')
        let watching: Promise<void> | undefined
        err = await convertAudio(
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
            watching = lockWhenWritten(p)
          },
        ).catch((e: unknown) => e)
        await watching
      } finally {
        if (locked) execFileSync('chflags', ['nouchg', locked])
      }

      // The encode has to have produced a real temp, or the assertions below would pass
      // on a file that never existed — exactly the vacuous green this test replaces.
      expect(tmpPath).not.toBe('')
      expect(locked).toBe(tmpPath)
      expect(existsSync(tmpPath)).toBe(true)
      expect((err as { tmpSurvived?: boolean }).tmpSurvived).toBe(true)
    },
    // The rename's full retry window is ~3.1s of real waiting, plus however long ffmpeg
    // takes to create the temp the poll above is waiting on. Both are real time, and the
    // default 5s leaves no room for either once the rest of the suite is competing for
    // CPU.
    30_000,
  )
})
