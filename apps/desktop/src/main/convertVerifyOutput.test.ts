import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
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
const midCorrupt = join(dir, 'midcorrupt.mp3')
const lyrics3Tail = join(dir, 'lyrics3.mp3')
const shortLyrics3 = join(dir, 'short-lyrics3.mp3')
const cutLyrics3 = join(dir, 'cut-lyrics3.mp3')
const longCut = join(dir, 'long-cut.mp3')

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
  // A real MP3 whose middle was overwritten: the header and opening frames are intact,
  // so ffmpeg opens it and prints a full banner, and only the decode hits the damage.
  // That is what makes it the fixture for "the failure is not the first stderr line" —
  // the all-garbage file above never gets far enough to print a banner at all.
  const whole = join(dir, 'whole.mp3')
  execFileSync(FF, [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=8',
    '-c:a',
    'libmp3lame',
    whole,
  ])
  const bytes = readFileSync(whole)
  writeFileSync(
    midCorrupt,
    Buffer.concat([
      bytes.subarray(0, 8000),
      Buffer.alloc(4000, 0x5a),
      bytes.subarray(bytes.length - 40000),
    ]),
  )
  // A Lyrics3v2 block between the last MPEG frame and the ID3v1 tag, exactly as three
  // of a user's MP3s carried it (17/09/2026): "LYRICSBEGIN", one ETT field, the six-digit
  // size, "LYRICS200", then "TAG". Winamp and MusicMatch wrote these; ffmpeg's mp3
  // demuxer does not know the format and hands the bytes to the decoder as a packet.
  const ett = 'ETT000010Some title'
  const lyrics3 = `LYRICSBEGIN${ett}${String(ett.length).padStart(6, '0')}LYRICS200`
  const id3v1 = Buffer.alloc(128)
  id3v1.write('TAG', 0, 'latin1')
  writeFileSync(lyrics3Tail, Buffer.concat([bytes, Buffer.from(lyrics3, 'latin1'), id3v1]))
  // The same tail on a two-second jingle, and on the eight-second file cut to a quarter.
  const short = join(dir, 'short.mp3')
  execFileSync(FF, [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=2',
    '-c:a',
    'libmp3lame',
    short,
  ])
  writeFileSync(
    shortLyrics3,
    Buffer.concat([readFileSync(short), Buffer.from(lyrics3, 'latin1'), id3v1]),
  )
  // Cut on a frame boundary (the next sync word past the quarter mark), so every frame
  // before the tail decodes cleanly and the only error is the tail itself — the shape of
  // a real file that lost its second half and then got a Lyrics3 block appended.
  let cut = Math.floor(bytes.length / 4)
  while (!(bytes[cut] === 0xff && (bytes[cut + 1] & 0xe0) === 0xe0)) cut++
  writeFileSync(
    cutLyrics3,
    Buffer.concat([bytes.subarray(0, cut), Buffer.from(lyrics3, 'latin1'), id3v1]),
  )
  // A file whose header reads past the minute mark, cut to a quarter: the header parser
  // has to weigh the minutes, not only the seconds every other fixture stays under.
  const long = join(dir, 'long.mp3')
  execFileSync(FF, [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=65',
    '-c:a',
    'libmp3lame',
    '-b:a',
    '32k',
    long,
  ])
  const longBytes = readFileSync(long)
  writeFileSync(longCut, longBytes.subarray(0, Math.floor(longBytes.length / 4)))
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

  // The detail appended to the key is the only description of WHY a conversion was
  // refused that reaches the user's bug report. The check now runs without -v error (the
  // truncation comparison needs the banner that flag suppresses), so this stderr carries
  // the full banner and the failure is no longer line one.
  //
  // Measured on this fixture — a valid MP3 header and frames, garbage spliced into the
  // middle, tail restored — ffmpeg's stderr opens with "filesize and duration do not
  // match (growing file?)", a warning that is NOT why it died, and closes with a bare
  // "Conversion failed!" that names nothing. The real diagnosis sits between them.
  //
  // What that diagnosis SAYS is the one thing not asserted here. ffmpeg-static ships 6.0
  // to macOS and 6.1.1 to Linux and Windows, and they word a failed mp3 decode
  // differently; pinning 6.0's "Header missing" passed on a developer's Mac and failed
  // the release on CI. The choice between candidate lines is pinned as data against both
  // builds' real output in convertVerifyErrorLine.test.ts, which needs no binary at all.
  it('reports the decoder failure, not the warning above it or the generic tail', async () => {
    const err = await assertDecodable(midCorrupt).catch((e: unknown) => e)

    expect(err, 'the fixture has to actually fail for this test to mean anything').toBeInstanceOf(
      Error,
    )
    const detail = (err as Error).message
    expect(detail, 'reported the opening warning instead of the cause').not.toMatch(/growing file/)
    expect(detail, 'reported the generic tail instead of the cause').not.toMatch(
      /Conversion failed/,
    )
    // Whichever build ran it, the line has to name the component that refused the data
    // and carry a diagnosis, not ffmpeg's end-of-run byte count.
    expect(detail, 'named no component at all').toMatch(/\[[^\]]+]/)
    expect(detail, 'reported the byte-count summary instead of the cause').not.toMatch(
      /muxing overhead/,
    )
  })
})

// Does a plain -xerror decode reject this file? The fixture only means something if it
// does: a tail ffmpeg happened to swallow would make the acceptance below trivially true.
function xerrorRejects(file: string): boolean {
  try {
    execFileSync(
      FF,
      ['-hide_banner', '-v', 'error', '-xerror', '-f', 'mp3', '-i', file, '-f', 'null', '-'],
      {
        stdio: 'ignore',
      },
    )
    return false
  } catch {
    return true
  }
}

describe('a complete file with junk after its last frame', () => {
  // Measured on the user's three files: the decoder delivered 374.47 s of a 374.54 s
  // header and then reported "Header missing" on the Lyrics3 bytes — one error, after
  // all the audio. -xerror turned that into "the converted file came out unreadable" on
  // every update of those MP3s, and the same-format copy carries the tail verbatim, so
  // the refusal was permanent. A file whose every frame decodes is not unreadable.
  it('is accepted even though -xerror alone would refuse it', async () => {
    expect(xerrorRejects(lyrics3Tail), 'the fixture no longer trips -xerror').toBe(true)
    await expect(assertDecodable(lyrics3Tail)).resolves.toBeUndefined()
  })

  // Under three seconds no ratio of decoded to declared length can be trusted, so the
  // bounded second pass is not attempted and the first verdict stands.
  it('is still refused when the file is too short for the second pass to mean anything', async () => {
    const err = await assertDecodable(shortLyrics3).catch((e: unknown) => e)
    expect(errorKeyOf((err as Error).message)).toBe('convertedOutputUnreadable')
  })

  // The second pass is bounded, not blind: on a file cut short the junk sits before the
  // bound, so the decoder meets it on the second pass too and the file is refused. It is
  // refused as unreadable rather than truncated — the decoder never got past the cut to
  // measure anything — and either way it is not delivered.
  it('still refuses a truncated file whose junk tail also trips -xerror', async () => {
    const err = await assertDecodable(cutLyrics3).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect(errorKeyOf((err as Error).message)).toBe('convertedOutputUnreadable')
  })

  it('weighs the minutes of the declared length when a long file is cut short', async () => {
    const err = await assertDecodable(longCut).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect(errorKeyOf((err as Error).message)).toBe('convertedOutputTruncated')
  })

  it('still fails when the junk sits in the middle of the audio', async () => {
    await expect(assertDecodable(midCorrupt)).rejects.toThrow()
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
