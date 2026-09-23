import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import {
  type Id3v2Tag,
  Id3v2UserTextInformationFrame,
  type Mpeg4AppleTag,
  File as TagFile,
  TagTypes,
  type XiphComment,
} from 'node-taglib-sharp'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import { convertAudio, readForeignTags, readTags } from './ffmpeg'
import { UPDATE_FORMAT, type UpdateExt } from './updateContract'

const FF = ffmpegStatic as unknown as string
const dir = mkdtempSync(join(tmpdir(), 'surco-custom-fields-'))

const CODEC: Record<UpdateExt, string[]> = {
  flac: ['-c:a', 'flac'],
  mp3: ['-c:a', 'libmp3lame', '-b:a', '320k'],
  aiff: ['-c:a', 'pcm_s16be'],
  wav: ['-c:a', 'pcm_s16le'],
  m4a: ['-c:a', 'alac'],
}
const EXTS = Object.keys(CODEC) as UpdateExt[]

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

// What another tagger leaves for a field it calls VINYLCONDITION: a TXXX frame, a Vorbis
// comment, an iTunes freeform atom.
function tagCondition(file: string, ext: UpdateExt, value: string): void {
  const f = TagFile.createFromPath(file)
  try {
    if (ext === 'flac') {
      ;(f.getTag(TagTypes.Xiph, true) as XiphComment).setFieldAsStrings('VINYLCONDITION', value)
    } else if (ext === 'm4a') {
      ;(f.tag as Mpeg4AppleTag).setItunesStrings('com.apple.iTunes', 'VINYLCONDITION', value)
    } else {
      const frame = Id3v2UserTextInformationFrame.fromDescription('VINYLCONDITION')
      frame.text = [value]
      ;(f.getTag(TagTypes.Id3v2, true) as Id3v2Tag).addFrame(frame)
    }
    f.save()
  } finally {
    f.dispose()
  }
}

async function conditionOf(file: string): Promise<string | undefined> {
  const tags = await readForeignTags(file)
  return tags.find((t) => t.name.toUpperCase() === 'VINYLCONDITION')?.value
}

// A custom field is the user's own tag, named by a key (vinylCondition) and written under
// its upper-case form, the convention mp3tag and TagScanner use for fields of their own.
// It has to land in every format and on both write paths, like any field Surco knows, and
// an emptied field has to clear it rather than leave the old value behind.
describe.each(EXTS)('a custom field on a %s', (ext) => {
  it('writes its value when updating in the same format', async () => {
    const src = encode(`update-src-${ext}`, ext)
    const out = join(dir, `update-out-${ext}.${ext}`)
    await convertAudio(src, out, UPDATE_FORMAT[ext], {
      ...(await readTags(src)),
      custom: { vinylCondition: 'VG+' },
    })
    expect(await conditionOf(out)).toBe('VG+')
  })

  it('writes its value when converting from another format', async () => {
    const src = encode(`convert-src-${ext}`, ext === 'wav' ? 'flac' : 'wav')
    const out = join(dir, `convert-out-${ext}.${ext}`)
    await convertAudio(src, out, UPDATE_FORMAT[ext], {
      ...(await readTags(src)),
      custom: { vinylCondition: 'VG+' },
    })
    expect(await conditionOf(out)).toBe('VG+')
  })

  it('clears the tag when the field is emptied', async () => {
    const src = encode(`clear-src-${ext}`, ext)
    tagCondition(src, ext, 'NM')
    expect(await conditionOf(src)).toBe('NM')
    const out = join(dir, `clear-out-${ext}.${ext}`)
    await convertAudio(src, out, UPDATE_FORMAT[ext], {
      ...(await readTags(src)),
      custom: { vinylCondition: '' },
    })
    expect(await conditionOf(out)).toBeUndefined()
  })
})
