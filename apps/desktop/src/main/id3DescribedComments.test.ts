import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  Id3v2CommentsFrame,
  Id3v2FrameClassType,
  type Id3v2Tag,
  File as TagFile,
  TagTypes,
} from 'node-taglib-sharp'
import { describe, expect, it } from 'vitest'
import { emptyMetadata } from '../shared/metadata'
import { encodeSine } from './sineTone.fixture'
import { setTagFields } from './tagFieldSet'
import { writeTags } from './tags'

const dir = mkdtempSync(join(tmpdir(), 'surco-described-comments-'))
let n = 0

const DESCRIBED = {
  iTunNORM: ' 000003E8 000003E8 00002A5C',
  iTunSMPB: ' 00000000 00000210 000007C0 0000000000ABCDEF',
  iTunPGAP: '1',
  'Songs-DB_Custom1': 'crate A',
}

// An MP3, AIFF or WAV as iTunes and other players tag it: the DJ's comment in a COMM with
// no description, and Sound Check, the gapless counts and another player's own field in
// COMM frames named by their description.
function itunesTagged(ext: 'mp3' | 'aiff' | 'wav', comment = 'Old comment'): string {
  const path = encodeSine(dir, `src${n++}`, ext)
  const f = TagFile.createFromPath(path)
  const id3 = f.getTag(TagTypes.Id3v2, true) as Id3v2Tag
  id3.version = 3
  id3.title = 'Old title'
  for (const [description, text] of [['', comment], ...Object.entries(DESCRIBED)]) {
    if (!text) continue
    const frame = Id3v2CommentsFrame.fromDescription(description, 'eng')
    frame.text = text
    id3.addFrame(frame)
  }
  f.save()
  f.dispose()
  return path
}

function comments(path: string): Record<string, string> {
  const f = TagFile.createFromPath(path)
  try {
    const id3 = f.getTag(TagTypes.Id3v2, false) as Id3v2Tag | null
    return Object.fromEntries(
      (id3?.getFramesByClassType<Id3v2CommentsFrame>(Id3v2FrameClassType.CommentsFrame) ?? []).map(
        (frame) => [frame.description, frame.text],
      ),
    )
  } finally {
    f.dispose()
  }
}

const meta = (comment: string) => ({ ...emptyMetadata(), title: 'New title', comment })

// TagLib's comment setter took every COMM frame for the comment: emptying the field took
// iTunes' Sound Check and gapless counts with it, and with no plain comment to reuse it
// wrote the DJ's comment over another player's field. Only the COMM with no description
// is the comment the DJ edits; the others are tags Surco does not manage.
describe.each(['mp3', 'aiff', 'wav'] as const)('an iTunes-tagged %s', (ext) => {
  it('keeps its described comments when the comment is emptied in place', () => {
    const path = itunesTagged(ext)
    writeTags(path, meta(''))
    expect(comments(path)).toEqual(DESCRIBED)
  })

  it('writes a new comment beside them, not over one of them', () => {
    const path = itunesTagged(ext, '')
    writeTags(path, meta('New comment'))
    expect(comments(path)).toEqual({ ...DESCRIBED, '': 'New comment' })
  })

  it('keeps them through a comment fix from the list', () => {
    const path = itunesTagged(ext)
    expect(setTagFields(path, [{ field: 'comment', from: 'Old comment', to: '' }])).toEqual([
      'written',
    ])
    expect(comments(path)).toEqual(DESCRIBED)
  })

  // The inspector lists each by its description, which ffmpeg reads it under.
  it('drops only the one the DJ deleted in the inspector', () => {
    const path = itunesTagged(ext)
    writeTags(path, meta('Old comment'), undefined, false, undefined, undefined, false, [
      'itunpgap',
    ])
    const { iTunPGAP: _, ...rest } = DESCRIBED
    expect(comments(path)).toEqual({ ...rest, '': 'Old comment' })
  })
})
