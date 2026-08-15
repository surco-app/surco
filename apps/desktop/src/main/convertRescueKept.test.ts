import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

// The destination is refused for good, exactly as a held file on Windows behaves after
// the backoff runs out — but the rescue itself is real, so the finished conversion ends
// up on disk under its sibling name and the assertion can look for it there.
vi.mock('./renameRetry', async (importOriginal) => {
  const real = await importOriginal<typeof import('./renameRetry')>()
  return {
    ...real,
    renameWithRetry: vi.fn(
      async (from: string, to: string, deps?: { rescue?: (t: string) => string }) => {
        const target = deps?.rescue?.(to)
        if (target) await rename(from, target)
        throw Object.assign(new Error(`${real.FILE_IN_USE_MARKER}: EPERM`), {
          code: 'EPERM',
          ...(target ? { rescuedTo: target } : {}),
        })
      },
    ),
  }
})

import log from 'electron-log/main'
import type { TrackMetadata } from '../shared/types'
import { convertAudio } from './ffmpeg'
import { rescuePath } from './renameRetry'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-rescuekept-'))
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

describe('a conversion whose destination never frees', () => {
  // The finished conversion has to still be on disk afterwards. It survives the cleanup
  // because the rescue renamed it out of `tmp`, but that is a property of rename, not a
  // decision anyone wrote down — so it is asserted here rather than assumed.
  it('keeps the rescued file instead of deleting it on the way out', async () => {
    const out = join(dir, 'held.flac')
    const rescued = rescuePath(out)

    await convertAudio(src, out, 'flac', meta).catch(() => {})

    expect(existsSync(rescued)).toBe(true)
  })

  // The user is only told "another program is using this file". Without a line naming
  // where the work went, a rescue leaves no trace in the log either, and neither the
  // user nor a later bug report can find the file that was saved.
  it('records where the rescued conversion landed', async () => {
    const out = join(dir, 'held-logged.flac')
    const rescued = rescuePath(out)
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => undefined as never)

    await convertAudio(src, out, 'flac', meta).catch(() => {})

    expect(warn.mock.calls.flat().join(' ')).toContain(rescued)
    warn.mockRestore()
  })
})
