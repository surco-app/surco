import { execFileSync } from 'node:child_process'
import { mkdtempSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { File as TagFile, TagTypes, type XiphComment } from 'node-taglib-sharp'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import { convertAudio, extractCoverFile, readTags } from './ffmpeg'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-update-idempotent-'))
const cover = join(dir, 'cover.jpg')
const src = join(dir, 'tagged.flac')

// Everything a second pass could drift on: the Vorbis fields as written, and the
// picture's role, format and bytes.
function snapshot(file: string): {
  fields: Record<string, string[]>
  pictures: { type: number; mime: string; bytes: string }[]
} {
  const f = TagFile.createFromPath(file)
  try {
    const xiph = f.getTag(TagTypes.Xiph, false) as XiphComment | null
    const fields = Object.fromEntries(
      (xiph?.fieldNames ?? [])
        .filter((n) => n.toUpperCase() !== 'ENCODER')
        .map((n) => [n, xiph?.getField(n) ?? []]),
    )
    const pictures = f.tag.pictures.map((p) => ({
      type: p.type,
      mime: p.mimeType,
      bytes: p.data.toBase64String(),
    }))
    return { fields, pictures }
  } finally {
    f.dispose()
  }
}

// What the "update" action does with a track whose cover is the file's own: the job
// names the file as the art source, main pulls the picture out and hands it back in.
async function update(input: string, output: string): Promise<void> {
  const art = await extractCoverFile(input)
  try {
    await convertAudio(input, output, 'flac', await readTags(input), art ?? undefined)
  } finally {
    if (art) unlinkSync(art)
  }
}

beforeAll(() => {
  execFileSync(FF, [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'nullsrc=s=300x300,geq=random(1)*255:128:128',
    '-frames:v',
    '1',
    cover,
  ])
  // Tagged the way mp3tag leaves a FLAC: a front cover and the seven fields the user's
  // file carried, with the label under ORGANIZATION.
  execFileSync(FF, [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=1',
    '-i',
    cover,
    '-map',
    '0:a',
    '-map',
    '1:v',
    '-c:a',
    'flac',
    '-c:v',
    'copy',
    '-disposition:v',
    'attached_pic',
    '-metadata:s:v:0',
    'comment=Cover (front)',
    '-metadata',
    'TITLE=Rave Till My Grave (Ashbreaker Unofficial Edit)',
    '-metadata',
    'ARTIST=Ashbreaker',
    '-metadata',
    'ALBUM=MQDRFREE015',
    '-metadata',
    'DATE=2026',
    '-metadata',
    'GENRE=HARDSTYLE',
    '-metadata',
    'ORGANIZATION=MQD Records',
    src,
  ])
  // ffmpeg would rename a COMMENT to DESCRIPTION on the way in, so the comment goes on
  // through TagLib, which writes the field under the name mp3tag uses.
  const f = TagFile.createFromPath(src)
  try {
    const xiph = f.getTag(TagTypes.Xiph, true) as XiphComment
    xiph.setFieldAsStrings('COMMENT', 'A2S B1S C2S D1S - E6 F4 G2 H1 I6 J4 K2 L1')
    f.save()
  } finally {
    f.dispose()
  }
  expect(snapshot(src).fields.COMMENT, 'the fixture has to carry COMMENT').toHaveLength(1)
})

// The user's complaint in one sentence (17/09/2026): he ran "update" on a FLAC he had
// already tagged, only to get the Finder thumbnail, and the file came back with more
// fields than it had, one renamed, and a smaller cover of a different type. An update
// that changes nothing has to write nothing new — and running it twice has to land on
// the same bytes, or every pass keeps eroding the file a little further.
describe('updating a FLAC in its own format', () => {
  it('keeps the comment, the label and the front cover exactly as tagged', async () => {
    const once = join(dir, 'once.flac')
    await update(src, once)
    const before = snapshot(src)
    const after = snapshot(once)
    expect(after.fields.COMMENT).toEqual(before.fields.COMMENT)
    expect(after.fields.DESCRIPTION).toBeUndefined()
    expect(after.fields.ALBUMARTIST).toBeUndefined()
    expect(after.pictures).toEqual(before.pictures)
  })

  it('lands on the same tags and picture when run a second time', async () => {
    const once = join(dir, 'pass1.flac')
    const twice = join(dir, 'pass2.flac')
    await update(src, once)
    await update(once, twice)
    expect(snapshot(twice)).toEqual(snapshot(once))
  })
})
