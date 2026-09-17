import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { Picture, PictureType, File as TagFile } from 'node-taglib-sharp'
import { beforeAll, describe, expect, it } from 'vitest'

import { diffSnapshots, snapshotTags } from './tagSnapshot'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-tag-snapshot-'))
const cover = join(dir, 'cover.jpg')

function encode(name: string, codec: string[], extra: string[] = []): string {
  const out = join(dir, name)
  execFileSync(FF, [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=1',
    ...codec,
    ...extra,
    out,
  ])
  return out
}

beforeAll(() => {
  execFileSync(FF, [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'color=c=red:s=32x32:d=1',
    '-frames:v',
    '1',
    cover,
  ])
})

// The instrument the conversion contract measures with. It has to tell apart what
// ffprobe folds together, or the contract is blind exactly where the defects were.
describe('snapshotTags', () => {
  // ffmpeg writes a FLAC comment as DESCRIPTION; ffprobe reads both spellings back as
  // "comment". Only the raw block tells them apart.
  it('spells a Vorbis field the way it sits on disk', () => {
    const file = encode('desc.flac', ['-c:a', 'flac'], ['-metadata', 'comment=x'])
    const lines = snapshotTags(file)
    expect(lines).toContain('xiph DESCRIPTION=x')
    expect(lines.some((l) => l.startsWith('xiph COMMENT='))).toBe(false)
  })

  it('names the picture type, so a front cover demoted to Other is a visible change', () => {
    const file = encode('art.mp3', ['-c:a', 'libmp3lame'])
    const f = TagFile.createFromPath(file)
    try {
      const p = Picture.fromPath(cover)
      p.type = PictureType.BackCover
      f.tag.pictures = [p]
      f.save()
    } finally {
      f.dispose()
    }
    expect(snapshotTags(file).some((l) => l.startsWith('id3 APIC[type=4,'))).toBe(true)
  })

  it('reads a WAV INFO chunk by its own ids, which TagLib never lists', () => {
    const file = encode(
      'info.wav',
      ['-c:a', 'pcm_s16le'],
      ['-metadata', 'artist=A', '-metadata', 'album=B'],
    )
    const lines = snapshotTags(file)
    expect(lines).toContain('riff IART=A')
    expect(lines).toContain('riff IPRD=B')
  })

  it('reports what a second snapshot added and removed', () => {
    expect(diffSnapshots(['a', 'b'], ['b', 'c'])).toEqual({ added: ['c'], removed: ['a'] })
  })
})
