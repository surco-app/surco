import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  Id3v2FrameClassType,
  type Id3v2Tag,
  Id3v2UserTextInformationFrame,
  File as TagFile,
  TagTypes,
  type XiphComment,
} from 'node-taglib-sharp'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import type { OutputFormat, TrackMetadata } from '../shared/types'
import { convertAudio, readMeta } from './ffmpeg'
import { encodeSine } from './sineTone.fixture'

const dir = mkdtempSync(join(tmpdir(), 'surco-duplicate-txxx-'))
let n = 0

// A tagger on ID3v2.3, which has no null-separated values, writes a second value as a
// second TXXX under the same description.
function twoStyles(ext: 'mp3' | 'aiff' | 'wav'): string {
  const path = encodeSine(dir, `src${n++}`, ext)
  const f = TagFile.createFromPath(path)
  const id3 = f.getTag(TagTypes.Id3v2, true) as Id3v2Tag
  id3.version = 3
  id3.title = 'Old title'
  for (const [description, text] of [
    ['STYLE', 'Deep House'],
    ['Style', 'Dark'],
  ]) {
    const frame = Id3v2UserTextInformationFrame.fromDescription(description)
    frame.text = [text]
    id3.addFrame(frame)
  }
  f.save()
  f.dispose()
  return path
}

function styles(path: string): string[] {
  const f = TagFile.createFromPath(path)
  try {
    const xiph = f.getTag(TagTypes.Xiph, false) as XiphComment | null
    if (xiph) return xiph.getField('STYLE')
    return (f.getTag(TagTypes.Id3v2, false) as Id3v2Tag)
      .getFramesByClassType<Id3v2UserTextInformationFrame>(
        Id3v2FrameClassType.UserTextInformationFrame,
      )
      .filter((frame) => frame.description.toUpperCase() === 'STYLE')
      .flatMap((frame) => frame.text)
  } finally {
    f.dispose()
  }
}

async function convert(path: string, target: OutputFormat, changes: Partial<TrackMetadata>) {
  const out = join(dir, `out${n++}.${target}`)
  await convertAudio(path, out, target, { ...(await readMeta(path)).tags, ...changes })
  return out
}

// The editor showed the first of the two, the next update wrote that one back and the
// second was gone from a WAV or a FLAC; an edit left the second behind in an MP3 or AIFF
// beside the new value, so the file read as the old style and the new one together.
describe.each(['mp3', 'aiff', 'wav'] as const)('an ID3v2.3 %s with two STYLE frames', (ext) => {
  it('shows both values in the editor', async () => {
    expect((await readMeta(twoStyles(ext))).tags.style).toBe('Deep House;Dark')
  })

  it.each([ext, 'flac'] as const)('keeps both through an update to %s', async (target) => {
    expect(styles(await convert(twoStyles(ext), target, { title: 'New title' }))).toEqual([
      'Deep House;Dark',
    ])
  })

  it('keeps both saving from a read that kept only the first', async () => {
    const out = await convert(twoStyles(ext), ext, { style: 'Deep House' })
    expect(styles(out)).toEqual(['Deep House;Dark'])
  })

  it('writes only what the DJ changed the style to', async () => {
    expect(styles(await convert(twoStyles(ext), ext, { style: 'Minimal' }))).toEqual(['Minimal'])
  })
})
