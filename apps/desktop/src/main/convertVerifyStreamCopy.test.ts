import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, statSync, truncateSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

// TagLib's save() rewrites the whole file when the tag grows (see ffmpeg.ts's own comment
// on the stream-copy branch), and it runs in the worker. A NAS write timeout or a full
// disk kills it partway through that rewrite, leaving the temp truncated. Every TagLib
// helper in tags.ts swallows its own failure by design ("Cue preservation is a bonus;
// never let it break a successful conversion"), so nothing upstream ever learns.
// This mock stands in for exactly that: the tag pass reports success and leaves a
// truncated file behind.
vi.mock('./worker', async () => {
  const actual = await vi.importActual<typeof import('./worker')>('./worker')
  return {
    ...actual,
    runInWorker: vi.fn(async (job: { type: string; file?: string }) => {
      if (job.type === 'writeTags' && job.file) {
        // Cut the audio short mid-rewrite, the way an interrupted save() does.
        const { size } = statSync(job.file)
        truncateSync(job.file, Math.floor(size / 4))
        return undefined
      }
      return undefined
    }),
  }
})

import type { TrackMetadata } from '../shared/types'
import { convertAudio } from './ffmpeg'

// Does a decoder accept the delivered file end to end? -xerror fails on the first
// packet it cannot read, the same check assertDecodable performs.
function decodable(file: string): boolean {
  try {
    execFileSync(FF, ['-hide_banner', '-v', 'error', '-xerror', '-i', file, '-f', 'null', '-'], {
      stdio: 'ignore',
    })
    return true
  } catch {
    return false
  }
}

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-copyverify-'))
const src = join(dir, 'in.mp3')

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
    'sine=frequency=440:duration=8',
    '-c:a',
    'libmp3lame',
    src,
  ])
})

// assertDecodable has exactly ONE call site (ffmpeg.ts:1400), inside the re-encode
// branch and BEFORE the TagLib passes that rewrite the whole file. The stream-copy
// branch — "source already in the target format", the everyday "just fix the tags"
// operation — never calls it at all. So a copy or a tag rewrite that dies partway is
// renamed over the destination and reported as a finished conversion. The comment at
// the rename asserts the opposite: "The temp is a finished conversion by now — audio,
// tags and cues all written".
describe('a stream-copy conversion whose tag pass truncated the audio', () => {
  it('fails instead of publishing the truncated file as converted', async () => {
    const out = join(dir, 'out.mp3')
    const err = await convertAudio(src, out, 'mp3', meta).catch((e: unknown) => e)

    // Measured on this fixture: 64591 bytes in, 16147 delivered — a quarter of the
    // audio — published to the user's folder while convertAudio returns success.
    //
    // Why nothing downstream notices, all three measured:
    //   · ffprobe format=duration reports 8.045714 for BOTH files (it trusts the
    //     Xing/LAME header, not the frames), so a duration comparison sees no problem.
    //   · `-xerror` decode PASSES on both, so assertDecodable would not catch it either
    //     — moving that one call after the tag pass is NOT sufficient.
    //   · Only reading the audio reveals it: 8.000 s vs 1.986 s of PCM,
    //     308 vs 77 counted frames.
    // The DJ gets a playable file that ends early. On stage the track just stops, and
    // under "replace the original" the source was already unlinked.
    // Se fija la medición para que el arreglo no se plantee mal: si el fichero
    // truncado se publicó, tiene que constar que un decode completo lo acepta. Quien
    // arregle esto no puede limitarse a mover la llamada de assertDecodable.
    if (existsSync(out)) {
      expect(decodable(out), 'un decode completo acepta el fichero truncado').toBe(true)
    }
    expect(err).toBeInstanceOf(Error)
    expect(existsSync(out)).toBe(false)
  })
})
