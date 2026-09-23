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

const dir = mkdtempSync(join(tmpdir(), 'surco-credit-fields-'))

const CREDITS = {
  originalArtist: 'The Original Band',
  lyricist: 'A. Lyricist',
  conductor: 'B. Conductor',
}

// Written the way TagScanner and mp3tag leave these credits: the ID3 frames, the Vorbis
// comments, and iTunes freeform atoms under the same names.
function tagLikeTagScanner(file: string, ext: UpdateExt): void {
  const f = TagFile.createFromPath(file)
  try {
    if (ext === 'flac') {
      const xiph = f.getTag(TagTypes.Xiph, true) as XiphComment
      xiph.setFieldAsStrings('ORIGARTIST', CREDITS.originalArtist)
      xiph.setFieldAsStrings('LYRICIST', CREDITS.lyricist)
      xiph.setFieldAsStrings('CONDUCTOR', CREDITS.conductor)
    } else if (ext === 'm4a') {
      const apple = f.tag as Mpeg4AppleTag
      apple.setItunesStrings('com.apple.iTunes', 'ORIGARTIST', CREDITS.originalArtist)
      apple.setItunesStrings('com.apple.iTunes', 'LYRICIST', CREDITS.lyricist)
      apple.setItunesStrings('com.apple.iTunes', 'CONDUCTOR', CREDITS.conductor)
    } else {
      const id3 = f.getTag(TagTypes.Id3v2, true) as Id3v2Tag
      for (const [id, value] of [
        [Id3v2FrameIdentifiers.TOPE, CREDITS.originalArtist],
        [Id3v2FrameIdentifiers.TEXT, CREDITS.lyricist],
        [Id3v2FrameIdentifiers.TPE3, CREDITS.conductor],
      ] as const) {
        const frame = Id3v2TextInformationFrame.fromIdentifier(id)
        frame.text = [value]
        id3.addFrame(frame)
      }
    }
    f.save()
  } finally {
    f.dispose()
  }
}

function creditsOf(tags: TrackMetadata): Partial<TrackMetadata> {
  return {
    originalArtist: tags.originalArtist,
    lyricist: tags.lyricist,
    conductor: tags.conductor,
  }
}

// A user tags these credits in TagScanner and runs the file through Surco. Until now the
// editor had no field for them, so they were invisible, and whether they survived depended
// on the path: a re-encode wrote only the fields Surco knows. Every format has to show
// what another tagger wrote and keep what the user edits, on both write paths.
describe.each(EXTS)('credit fields on a %s', (ext) => {
  it('reads the credits another tagger wrote', async () => {
    const file = encodeSine(dir, `read-${ext}`, ext)
    tagLikeTagScanner(file, ext)
    expect(creditsOf(await readTags(file))).toEqual(CREDITS)
  })

  it('writes the edited credits when updating in the same format', async () => {
    const src = encodeSine(dir, `update-src-${ext}`, ext)
    const out = join(dir, `update-out-${ext}.${ext}`)
    await convertAudio(src, out, UPDATE_FORMAT[ext], { ...(await readTags(src)), ...CREDITS })
    expect(creditsOf(await readTags(out))).toEqual(CREDITS)
  })

  it('writes the edited credits when converting from another format', async () => {
    const src = encodeSine(dir, `convert-src-${ext}`, ext === 'wav' ? 'flac' : 'wav')
    const out = join(dir, `convert-out-${ext}.${ext}`)
    await convertAudio(src, out, UPDATE_FORMAT[ext], { ...(await readTags(src)), ...CREDITS })
    expect(creditsOf(await readTags(out))).toEqual(CREDITS)
  })
})
