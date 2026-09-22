import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { File as TagFile } from 'node-taglib-sharp'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import type { TrackMetadata } from '../shared/types'
import { convertAudio, readTags } from './ffmpeg'
import { UPDATE_FORMAT, type UpdateExt } from './updateContract'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-total-fields-'))

const CODEC: Record<UpdateExt, string[]> = {
  flac: ['-c:a', 'flac'],
  mp3: ['-c:a', 'libmp3lame', '-b:a', '320k'],
  aiff: ['-c:a', 'pcm_s16be'],
  wav: ['-c:a', 'pcm_s16le'],
  m4a: ['-c:a', 'alac'],
}
const EXTS = Object.keys(CODEC) as UpdateExt[]

const NUMBERS = { trackNumber: '3', trackTotal: '12', discNumber: '1', discTotal: '2' }

function encode(name: string, ext: UpdateExt): string {
  const file = join(dir, `${name}.${ext}`)
  execFileSync(FF, [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=1',
    ...CODEC[ext],
    file,
  ])
  return file
}

// TagScanner's "3/12" and "1/2": TRCK and TPOS on ID3, TRACKTOTAL and DISCTOTAL beside
// the numbers on Vorbis, the second half of trkn and disk on MP4. TagLib writes each
// container's own form from the generic counts.
function tagLikeTagScanner(file: string): void {
  const f = TagFile.createFromPath(file)
  try {
    f.tag.track = 3
    f.tag.trackCount = 12
    f.tag.disc = 1
    f.tag.discCount = 2
    f.save()
  } finally {
    f.dispose()
  }
}

function numbersOf(tags: TrackMetadata): Partial<TrackMetadata> {
  return {
    trackNumber: tags.trackNumber,
    trackTotal: tags.trackTotal,
    discNumber: tags.discNumber,
    discTotal: tags.discTotal,
  }
}

// Surco read "3/12" as "3" and wrote back "3": every file that passed through it lost the
// totals another tagger had set, with no field in the editor to notice or restore them.
describe.each(EXTS)('track and disc totals on a %s', (ext) => {
  it('reads the totals another tagger wrote', async () => {
    const file = encode(`read-${ext}`, ext)
    tagLikeTagScanner(file)
    expect(numbersOf(await readTags(file))).toEqual(NUMBERS)
  })

  it('keeps the totals when updating in the same format', async () => {
    const src = encode(`update-src-${ext}`, ext)
    tagLikeTagScanner(src)
    const out = join(dir, `update-out-${ext}.${ext}`)
    await convertAudio(src, out, UPDATE_FORMAT[ext], await readTags(src))
    expect(numbersOf(await readTags(out))).toEqual(NUMBERS)
  })

  it('writes the totals when converting from another format', async () => {
    const src = encode(`convert-src-${ext}`, ext === 'wav' ? 'flac' : 'wav')
    const out = join(dir, `convert-out-${ext}.${ext}`)
    await convertAudio(src, out, UPDATE_FORMAT[ext], { ...(await readTags(src)), ...NUMBERS })
    expect(numbersOf(await readTags(out))).toEqual(NUMBERS)
  })
})
