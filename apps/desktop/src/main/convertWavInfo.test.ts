import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import type { TrackMetadata } from '../shared/types'
import { convertAudio, readMeta } from './ffmpeg'

const FF = ffmpegStatic as unknown as string

const meta: TrackMetadata = {
  title: 'Someone, Somewhere',
  artist: 'Two Powers',
  album: 'In Summer Time',
  albumArtist: 'Two Powers',
  year: '1995',
  genre: 'Electronic',
  grouping: 'Crate A',
  comment: '11A - Energy 7',
  trackNumber: '1',
  discNumber: '',
  bpm: '138',
  key: '11A',
  publisher: 'Lethal Records',
  catalogNumber: 'LT-015-MX',
  remixArtist: '',
}

let dir: string
let source: string

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'surco-wavinfo-'))
  source = join(dir, 'source.wav')
  execFileSync(FF, [
    '-v',
    'quiet',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=1',
    '-y',
    source,
  ])
})

// The RIFF INFO chunk's own field names, as they sit in the file. A WAV can carry tags in
// two places at once — RIFF INFO and an ID3 "id3 " chunk — and which one a program reads
// is not negotiable from our side: Traktor reads INFO.
function riffInfoFields(path: string): string[] {
  const text = readFileSync(path).toString('latin1')
  const info = text.indexOf('INFO')
  if (info === -1) return []
  return [...text.slice(info).matchAll(/(INAM|IART|IPRD|ICMT|IGNR|ICRD|IPRT)/g)].map((m) => m[1])
}

// djotas, on a WAV Surco converted: Traktor showed no artist and put the file name in the
// title, while mp3tag read the file correctly. mp3tag reads the ID3 chunk Surco writes;
// Traktor reads RIFF INFO, which the TagLib pass was deleting outright. The deletion was
// deliberate — INFO has no grouping field, so leaving a stale INFO behind made grouping
// unreadable on re-import — but it traded a whole DJ program's view of the file for one
// field. Both tags stay now, with INFO rewritten from the same metadata rather than left
// stale, so grouping still round-trips through ID3 and Traktor still sees a titled track.
describe('a WAV conversion keeps the tags Traktor reads', () => {
  it('carries a RIFF INFO title and artist, not only ID3', async () => {
    const out = join(dir, 'traktor.wav')
    await convertAudio(source, out, 'wav', meta)

    const fields = riffInfoFields(out)
    expect(fields).toContain('INAM')
    expect(fields).toContain('IART')
  })

  // The reason INFO was dropped in the first place: grouping has no INFO field, so it can
  // only survive in ID3. Dropping INFO fixed that at Traktor's expense; keeping both must
  // not bring the original bug back.
  it('still round-trips grouping, which INFO cannot hold', async () => {
    const out = join(dir, 'grouping.wav')
    await convertAudio(source, out, 'wav', meta)

    expect((await readMeta(out)).tags.grouping).toBe('Crate A')
  })

  it('reads its own title and artist back', async () => {
    const out = join(dir, 'roundtrip.wav')
    await convertAudio(source, out, 'wav', meta)

    const tags = (await readMeta(out)).tags
    expect(tags.title).toBe('Someone, Somewhere')
    expect(tags.artist).toBe('Two Powers')
  })
})
