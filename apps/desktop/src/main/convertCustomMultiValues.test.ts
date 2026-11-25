import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  Id3v2FrameClassType,
  type Id3v2Tag,
  Id3v2UserTextInformationFrame,
  File as TagFile,
  TagTypes,
} from 'node-taglib-sharp'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import type { OutputFormat } from '../shared/types'
import { convertAudio, readMeta } from './ffmpeg'
import { encodeSine } from './sineTone.fixture'

const dir = mkdtempSync(join(tmpdir(), 'surco-custom-multi-'))
let n = 0

// A custom field the DJ defined (vinylCondition, written as VINYLCONDITION) on a file whose
// tagger gave it two values: null-separated in one TXXX on ID3v2.4, two TXXX on v2.3.
function tagged(ext: 'mp3' | 'aiff' | 'wav', version: 3 | 4): string {
  const path = encodeSine(dir, `src${n++}`, ext)
  const f = TagFile.createFromPath(path)
  const id3 = f.getTag(TagTypes.Id3v2, true) as Id3v2Tag
  id3.version = version
  id3.title = 'Old title'
  for (const values of version === 4 ? [['VG', 'NM']] : [['VG'], ['NM']]) {
    const frame = Id3v2UserTextInformationFrame.fromDescription('VinylCondition')
    frame.text = values
    id3.addFrame(frame)
  }
  f.save()
  f.dispose()
  return path
}

function vinylCondition(path: string): string[] {
  const f = TagFile.createFromPath(path)
  try {
    return (f.getTag(TagTypes.Id3v2, false) as Id3v2Tag)
      .getFramesByClassType<Id3v2UserTextInformationFrame>(
        Id3v2FrameClassType.UserTextInformationFrame,
      )
      .filter((frame) => frame.description.toUpperCase() === 'VINYLCONDITION')
      .flatMap((frame) => frame.text)
  } finally {
    f.dispose()
  }
}

// The field shows what the inspector read, the first value only, and every conversion
// hands the custom fields over whole, so the save wrote that first value back as the
// field and the second was gone from the file, edited or not.
describe.each(['mp3', 'aiff', 'wav'] as const)('a %s', (ext) => {
  describe.each([3, 4] as const)('on ID3v2.%i with a two-value custom field', (version) => {
    it.each(['mp3', 'aiff', 'wav'] as OutputFormat[])(
      'keeps both values converted to %s',
      async (target) => {
        const src = tagged(ext, version)
        const out = join(dir, `out${n++}.${target}`)
        const meta = { ...(await readMeta(src)).tags, title: 'New title' }
        await convertAudio(src, out, target, { ...meta, custom: { vinylCondition: 'VG' } })
        expect(vinylCondition(out)).toEqual(['VG;NM'])
      },
    )

    it('writes what the DJ changed it to', async () => {
      const src = tagged(ext, version)
      const out = join(dir, `out${n++}.${ext}`)
      const meta = { ...(await readMeta(src)).tags, custom: { vinylCondition: 'Mint' } }
      await convertAudio(src, out, ext, meta)
      expect(vinylCondition(out)).toEqual(['Mint'])
    })
  })
})
