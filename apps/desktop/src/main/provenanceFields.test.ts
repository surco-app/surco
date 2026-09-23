import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  Id3v2FrameIdentifiers,
  type Id3v2Tag,
  Id3v2TextInformationFrame,
  type Mpeg4AppleTag,
  File as TagFile,
  TagTypes,
  type XiphComment,
} from 'node-taglib-sharp'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import type { TrackMetadata } from '../shared/types'
import { convertAudio, readTags } from './ffmpeg'
import { EXTS, encodeSine } from './sineTone.fixture'
import { UPDATE_FORMAT, type UpdateExt } from './updateContract'

const dir = mkdtempSync(join(tmpdir(), 'surco-provenance-fields-'))

const OWNED = { copyright: '(P) 2026 MQD Records', encodedBy: 'A. Ripper' }
const BLANK = { copyright: '', encodedBy: '' }

// The copyright through TagLib's own property (TCOP, COPYRIGHT, cprt), the encoder
// credit as TagScanner and mp3tag write it: TENC on ID3, ENCODEDBY elsewhere.
function tagLikeTagScanner(file: string, ext: UpdateExt): void {
  const f = TagFile.createFromPath(file)
  try {
    f.tag.copyright = OWNED.copyright
    if (ext === 'flac') {
      ;(f.getTag(TagTypes.Xiph, true) as XiphComment).setFieldAsStrings(
        'ENCODEDBY',
        OWNED.encodedBy,
      )
    } else if (ext === 'm4a') {
      ;(f.tag as Mpeg4AppleTag).setItunesStrings('com.apple.iTunes', 'ENCODEDBY', OWNED.encodedBy)
    } else {
      const frame = Id3v2TextInformationFrame.fromIdentifier(Id3v2FrameIdentifiers.TENC)
      frame.text = [OWNED.encodedBy]
      ;(f.getTag(TagTypes.Id3v2, true) as Id3v2Tag).addFrame(frame)
    }
    f.save()
  } finally {
    f.dispose()
  }
}

function provenanceOf(tags: TrackMetadata): Partial<TrackMetadata> {
  return { copyright: tags.copyright, encodedBy: tags.encodedBy }
}

// Copyright and "encoded by" were cleared on every conversion, so the previous owner's
// studio and ripping tool would not ride along into a file that is now the user's. A
// TagScanner user who sets them on purpose lost them the same way. As fields they show
// what the file carries and write what the editor holds: an empty field still clears
// them, which is what the editor sends while the user keeps the fields hidden.
describe.each(EXTS)('copyright and encoded-by on a %s', (ext) => {
  it('reads what another tagger wrote', async () => {
    const file = encodeSine(dir, `read-${ext}`, ext)
    tagLikeTagScanner(file, ext)
    expect(provenanceOf(await readTags(file))).toEqual(OWNED)
  })

  it('keeps them when updating in the same format with the values in the editor', async () => {
    const src = encodeSine(dir, `keep-src-${ext}`, ext)
    tagLikeTagScanner(src, ext)
    const out = join(dir, `keep-out-${ext}.${ext}`)
    await convertAudio(src, out, UPDATE_FORMAT[ext], await readTags(src))
    expect(provenanceOf(await readTags(out))).toEqual(OWNED)
  })

  it('writes them when converting from another format', async () => {
    const src = encodeSine(dir, `convert-src-${ext}`, ext === 'wav' ? 'flac' : 'wav')
    const out = join(dir, `convert-out-${ext}.${ext}`)
    await convertAudio(src, out, UPDATE_FORMAT[ext], { ...(await readTags(src)), ...OWNED })
    expect(provenanceOf(await readTags(out))).toEqual(OWNED)
  })

  it('clears the previous owner values when the editor sends them empty', async () => {
    const src = encodeSine(dir, `clear-src-${ext}`, ext === 'wav' ? 'flac' : 'wav')
    tagLikeTagScanner(src, ext === 'wav' ? 'flac' : 'wav')
    const out = join(dir, `clear-out-${ext}.${ext}`)
    await convertAudio(src, out, UPDATE_FORMAT[ext], { ...(await readTags(src)), ...BLANK })
    expect(provenanceOf(await readTags(out))).toEqual(BLANK)
  })
})
