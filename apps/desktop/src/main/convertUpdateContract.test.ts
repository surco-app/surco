import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { Picture, PictureType, File as TagFile } from 'node-taglib-sharp'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import type { OutputFormat } from '../shared/types'
import { prepareProcessedCover } from './cover'
import { convertAudio, readTags } from './ffmpeg'
import { diffSnapshots, snapshotTags } from './tagSnapshot'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-update-contract-'))
const jpegCover = join(dir, 'cover.jpg')
const pngCover = join(dir, 'cover.png')

type Ext = 'flac' | 'mp3' | 'aiff' | 'wav' | 'm4a'

const FORMATS: { ext: Ext; format: OutputFormat; codec: string[] }[] = [
  { ext: 'flac', format: 'flac', codec: ['-c:a', 'flac'] },
  { ext: 'mp3', format: 'mp3', codec: ['-c:a', 'libmp3lame', '-b:a', '320k'] },
  { ext: 'aiff', format: 'aiff', codec: ['-c:a', 'pcm_s16be'] },
  { ext: 'wav', format: 'wav', codec: ['-c:a', 'pcm_s16le'] },
  { ext: 'm4a', format: 'alac', codec: ['-c:a', 'alac'] },
]
const COVERS = ['jpg', 'png', 'none'] as const

// The changes a first pass is allowed to make to a file another tagger left, each one a
// decision taken elsewhere on purpose. Anything outside these lists is a field the
// update invented, renamed, duplicated or lost — the four kinds a user found comparing
// a FLAC before and after in mp3tag (17/09/2026). Every entry names its reason so the
// list reads as a contract, not as a way to make the test pass.
const ALLOWED: Record<Ext, { added: RegExp[]; removed: RegExp[] }> = {
  flac: {
    added: [
      // The label under both names Traktor and the shops read (tagFields: vorbisAlso).
      /^xiph (LABEL|PUBLISHER)=/,
      // The key under the second name rekordbox reads (tagFields: vorbisAlso).
      /^xiph KEY=/,
      // TagLib spells the BPM TEMPO; Surco writes the BPM name DJ software reads.
      /^xiph BPM=/,
      // Art in any other format is transcoded to JPEG, the one format every consumer takes.
      /^picture type=3 mime=image\/jpeg /,
    ],
    removed: [
      // The label's third spelling, cleared so it cannot resurface beside the two written.
      /^xiph ORGANIZATION=/,
      /^xiph TEMPO=/,
      // The encoder's own stamp.
      /^xiph ENCODER=/,
      /^picture type=3 mime=image\/png /,
    ],
  },
  mp3: {
    added: [
      // Surco writes ID3v2.3 (TYER) for the readers that never learned 2.4's TDRC.
      /^id3 TYER=/,
      // The picture is re-described as "<album>.jpg", which mp3tag and DJ software show.
      /^id3 APIC\[type=3,mime=image\/jpeg,desc=/,
    ],
    removed: [/^id3 TDRC=/, /^id3 APIC\[type=3,/],
  },
  aiff: {
    added: [/^id3 TYER=/, /^id3 APIC\[type=3,mime=image\/jpeg,desc=/],
    removed: [/^id3 TDRC=/, /^id3 APIC\[type=3,/],
  },
  wav: {
    added: [
      /^id3 TYER=/,
      /^id3 APIC\[type=3,mime=image\/jpeg,desc=/,
      /^picture type=3 mime=image\/jpeg /,
      // ffmpeg's INFO spelling of the album, written beside TagLib's DIRC.
      /^riff IPRD=/,
      /^riff IART=/,
    ],
    removed: [
      /^id3 TDRC=/,
      /^id3 APIC\[type=3,/,
      /^picture type=3 mime=image\/png /,
      // The encoder's own stamp.
      /^riff ISFT=/,
    ],
  },
  m4a: {
    added: [/^mp4 covr=/, /^picture type=3 mime=image\/jpeg /],
    removed: [/^mp4 ©too=/, /^mp4 covr=/, /^picture type=3 mime=image\/png /],
  },
}

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

// What "update" does with a track whose cover is the file's own: the job names the file
// as the art source, main pulls the picture out and runs it through the cover settings,
// and the editor's values (readMeta's tags) are what the conversion writes back.
async function update(input: string, output: string, format: OutputFormat): Promise<void> {
  const prepared = await prepareProcessedCover(
    { coverFromFile: input },
    { maxSize: 1200, square: false, upscale: false },
  )
  try {
    await convertAudio(input, output, format, await readTags(input), prepared?.path)
  } finally {
    await prepared?.cleanup()
  }
}

function unexplained(lines: string[], rules: RegExp[]): string[] {
  return lines.filter((l) => !rules.some((r) => r.test(l)))
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
describe.each(FORMATS)('updating a $ext in its own format', ({ ext, format, codec }) => {
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
      await update(src, pass1, format)
      await update(pass1, pass2, format)
      before = snapshotTags(src)
      after1 = snapshotTags(pass1)
      after2 = snapshotTags(pass2)
    }, 120000)

    it('changes nothing it was not meant to on the first pass', () => {
      const { added, removed } = diffSnapshots(before, after1)
      expect(unexplained(added, ALLOWED[ext].added), 'fields the update invented').toEqual([])
      expect(unexplained(removed, ALLOWED[ext].removed), 'fields the update lost').toEqual([])
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
