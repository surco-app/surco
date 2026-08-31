import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { platform, tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))
// A stand-in ffmpeg that behaves like the real one except when asked to write an .mp3:
// then it emits bytes no decoder can read, which is what a user's Windows build did
// with one filter chain. The real binary still runs every measurement and the check.
vi.mock('./binaries', async () => {
  const actual = await vi.importActual<typeof import('./binaries')>('./binaries')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  return { ...actual, ffmpegPath: join(tmpdir(), `surco-fake-ffmpeg-${process.pid}.sh`) }
})

import { errorKeyOf } from '../shared/errorKeys'
import type { TrackMetadata } from '../shared/types'
import { assertDecodable, convertAudio } from './ffmpeg'

const FF = ffmpegStatic as unknown as string
const fakeFfmpeg = join(tmpdir(), `surco-fake-ffmpeg-${process.pid}.sh`)
const dir = mkdtempSync(join(tmpdir(), 'surco-verify-'))
const src = join(dir, 'in.flac')
const garbage = join(dir, 'garbage.mp3')

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
  writeFileSync(garbage, Buffer.from('ID3'.repeat(4).concat('x'.repeat(65536))))
  writeFileSync(
    fakeFfmpeg,
    [
      '#!/bin/sh',
      'for a in "$@"; do last="$a"; done',
      'case "$last" in',
      `  *.mp3) cat "${garbage}" > "$last"; exit 0;;`,
      'esac',
      `exec "${FF}" "$@"`,
      '',
    ].join('\n'),
  )
  chmodSync(fakeFfmpeg, 0o755)
})

describe('assertDecodable', () => {
  // The whole point of the check: a file ffmpeg cannot decode must be refused with a
  // key the renderer can translate, not delivered as a finished conversion.
  it('rejects a file whose frames no decoder can read', async () => {
    const err = await assertDecodable(garbage).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect(errorKeyOf((err as Error).message)).toBe('convertedOutputUnreadable')
  })

  it('accepts a file ffmpeg decodes cleanly', async () => {
    await expect(assertDecodable(src)).resolves.toBeUndefined()
  })
})

describe.skipIf(platform() === 'win32')('a conversion whose encode wrote unreadable audio', () => {
  // Before this check the broken file went through the tag pass and the rename like any
  // other, and with "replace the original" it took the source's place: the user found
  // out only when Surco itself could not open the result.
  it('fails with a translatable error instead of delivering the file', async () => {
    const out = join(dir, 'out.mp3')
    let tmpPath = ''
    const err = await convertAudio(
      src,
      out,
      'mp3',
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

    expect(errorKeyOf((err as Error).message)).toBe('convertedOutputUnreadable')
    expect(existsSync(out)).toBe(false)
    expect(tmpPath).not.toBe('')
    expect(existsSync(tmpPath)).toBe(false)
  })
})
