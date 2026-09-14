import { execFileSync } from 'node:child_process'
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { platform, tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))
// A stand-in ffmpeg that refuses to write the output and says why on stderr, the way
// the real one does when the destination cannot be written (a read-only folder, a
// permission the user lost, an antivirus holding the path). Everything else defers to
// the real binary, so the measurement passes that run before the encode still work.
vi.mock('./binaries', async () => {
  const actual = await vi.importActual<typeof import('./binaries')>('./binaries')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  return { ...actual, ffmpegPath: join(tmpdir(), `surco-deny-ffmpeg-${process.pid}.sh`) }
})

import type { TrackMetadata } from '../shared/types'
import { convertAudio } from './ffmpeg'

const FF = ffmpegStatic as unknown as string
const fakeFfmpeg = join(tmpdir(), `surco-deny-ffmpeg-${process.pid}.sh`)
const dir = mkdtempSync(join(tmpdir(), 'surco-encode-err-'))
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
  // Fails only the encode that writes the temp output, and prints a banner first so the
  // diagnosis is NOT the opening line — the same shape the real failure has.
  writeFileSync(
    fakeFfmpeg,
    [
      '#!/bin/sh',
      'for a in "$@"; do last="$a"; done',
      'case "$last" in',
      '  *.tmp-*)',
      '    echo "ffmpeg version 6.0 Copyright (c) 2000-2023 the FFmpeg developers" >&2',
      '    echo "  libavutil      58.  2.100 / 58.  2.100" >&2',
      '    echo "Input #0, flac, from \'$1\':" >&2',
      '    echo "  Duration: 00:00:01.00, bitrate: 1411 kb/s" >&2',
      '    echo "[out#0/aiff @ 0x600001] Could not open file : Permission denied" >&2',
      '    echo "Conversion failed!" >&2',
      '    exit 1;;',
      'esac',
      `exec "${FF}" "$@"`,
      '',
    ].join('\n'),
  )
  chmodSync(fakeFfmpeg, 0o755)
})

// The message reaches the user as a toast card. Before this, a failed encode surfaced
// Node's own execFile text: "Command failed: /path/to/ffmpeg -y -i ..." followed by the
// ENTIRE command line — every -metadata flag Surco writes, roughly forty of them — and
// then the whole banner. The one line that says WHY sat at the bottom of a wall of text,
// and the toast names the track now, so the name competed with the dump for the first
// line the user reads.
describe.skipIf(platform() === 'win32')('a conversion whose encode fails', () => {
  it('reports the failure line instead of the whole ffmpeg command', async () => {
    const out = join(dir, 'out.aiff')
    const err = await convertAudio(src, out, 'aiff', meta).catch((e: unknown) => e)

    expect(err, 'the fixture has to actually fail for this test to mean anything').toBeInstanceOf(
      Error,
    )
    const detail = (err as Error).message
    expect(detail, 'kept the diagnosis').toMatch(/Permission denied/)
    expect(detail, 'dumped the command line Node prepends').not.toMatch(/Command failed/)
    expect(detail, 'dumped the -metadata flags Surco writes').not.toMatch(/-metadata/)
    expect(detail, 'reported the generic tail instead of the cause').not.toMatch(
      /Conversion failed!/,
    )
    // A toast line, not a transcript: the old message ran to thousands of characters.
    expect(detail.length, `still long: ${detail.slice(0, 120)}`).toBeLessThan(200)
  })
})
