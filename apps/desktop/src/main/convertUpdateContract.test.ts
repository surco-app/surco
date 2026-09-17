import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { Picture, PictureType, File as TagFile } from 'node-taglib-sharp'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import { diffSnapshots, snapshotTags } from './tagSnapshot'
import {
  ALLOWED_UPDATE_CHANGES,
  type UpdateExt,
  unexplainedChanges,
  updateLikeTheApp,
} from './updateContract'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-update-contract-'))
const jpegCover = join(dir, 'cover.jpg')
const pngCover = join(dir, 'cover.png')

const FORMATS: { ext: UpdateExt; codec: string[] }[] = [
  { ext: 'flac', codec: ['-c:a', 'flac'] },
  { ext: 'mp3', codec: ['-c:a', 'libmp3lame', '-b:a', '320k'] },
  { ext: 'aiff', codec: ['-c:a', 'pcm_s16be'] },
  { ext: 'wav', codec: ['-c:a', 'pcm_s16le'] },
  { ext: 'm4a', codec: ['-c:a', 'alac'] },
]
const COVERS = ['jpg', 'png', 'none'] as const

function makeImage(path: string, size: string): void {
  execFileSync(FF, [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    `nullsrc=s=${size},geq=random(1)*255:128:128`,
    '-frames:v',
    '1',
    path,
  ])
}

// Tagged the way mp3tag leaves a file: TagLib's own spellings, a typed front cover.
function tagLikeMp3tag(file: string, cover?: string): void {
  const f = TagFile.createFromPath(file)
  try {
    f.tag.title = 'Rave Till My Grave (Ashbreaker Unofficial Edit)'
    f.tag.performers = ['Ashbreaker']
    f.tag.album = 'MQDRFREE015'
    f.tag.year = 2026
    f.tag.genres = ['HARDSTYLE']
    f.tag.comment = 'A2S B1S C2S D1S - E6 F4 G2 H1 I6 J4 K2 L1'
    f.tag.publisher = 'MQD Records'
    f.tag.beatsPerMinute = 150
    f.tag.initialKey = '11A'
    f.tag.grouping = 'Peak'
    if (cover) {
      const p = Picture.fromPath(cover)
      p.type = PictureType.FrontCover
      f.tag.pictures = [p]
    }
    f.save()
  } finally {
    f.dispose()
  }
}

beforeAll(() => {
  makeImage(jpegCover, '600x600')
  makeImage(pngCover, '64x64')
})

// The user's complaint in one sentence: he ran "update" on a file he had already tagged,
// only to get the Finder thumbnail, and it came back with more fields than it had, one
// renamed, one lost, and a smaller cover of another type. So, for every container and
// every kind of art: a first pass changes only what the lists above say, and a second
// pass changes nothing at all — otherwise every update keeps eroding the file.
describe.each(FORMATS)('updating a $ext in its own format', ({ ext, codec }) => {
  describe.each(COVERS)('with %s art', (cover) => {
    const src = join(dir, `${ext}-${cover}-src.${ext}`)
    const pass1 = join(dir, `${ext}-${cover}-pass1.${ext}`)
    const pass2 = join(dir, `${ext}-${cover}-pass2.${ext}`)
    let before: string[]
    let after1: string[]
    let after2: string[]

    beforeAll(async () => {
      execFileSync(FF, [
        '-y',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:duration=2',
        ...codec,
        src,
      ])
      tagLikeMp3tag(src, cover === 'none' ? undefined : join(dir, `cover.${cover}`))
      await updateLikeTheApp(src, pass1, ext)
      await updateLikeTheApp(pass1, pass2, ext)
      before = snapshotTags(src)
      after1 = snapshotTags(pass1)
      after2 = snapshotTags(pass2)
    }, 120000)

    it('changes nothing it was not meant to on the first pass', () => {
      const { added, removed } = diffSnapshots(before, after1)
      expect(
        unexplainedChanges(added, ALLOWED_UPDATE_CHANGES[ext].added),
        'fields the update invented',
      ).toEqual([])
      expect(
        unexplainedChanges(removed, ALLOWED_UPDATE_CHANGES[ext].removed),
        'fields the update lost',
      ).toEqual([])
    })

    it('lands on the same tags and picture when run a second time', () => {
      expect(diffSnapshots(after1, after2)).toEqual({ added: [], removed: [] })
    })

    if (cover === 'jpg') {
      it('keeps the JPEG cover byte for byte', () => {
        const [sha] = before
          .filter((l) => /mime=image\/jpeg/.test(l))
          .map((l) => l.match(/sha1=\w+/)?.[0])
        expect(sha).toBeDefined()
        expect(after1.some((l) => l.includes(sha as string))).toBe(true)
      })
    }
  })
})
