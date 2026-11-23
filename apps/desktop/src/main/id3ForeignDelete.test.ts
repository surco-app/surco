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
import { describe, expect, it } from 'vitest'
import { emptyMetadata } from '../shared/metadata'
import { encodeSine } from './sineTone.fixture'
import { writeTags } from './tags'

const dir = mkdtempSync(join(tmpdir(), 'surco-foreign-delete-'))
let n = 0

const FOREIGN: [string, string][] = [
  ['Vinyl Condition', 'VG+'],
  ['Vinyl Condition Notes', 'light scuffs'],
  ['SESSION', 'take 1'],
  ['SESSION', 'take 2'],
  ['MUSICBRAINZ ARTIST ID', 'mbid'],
]

function tagged(ext: 'mp3' | 'aiff' | 'wav'): string {
  const path = encodeSine(dir, `src${n++}`, ext)
  const f = TagFile.createFromPath(path)
  const id3 = f.getTag(TagTypes.Id3v2, true) as Id3v2Tag
  id3.version = 3
  for (const [description, text] of FOREIGN) {
    const frame = Id3v2UserTextInformationFrame.fromDescription(description)
    frame.text = [text]
    id3.addFrame(frame)
  }
  f.save()
  f.dispose()
  return path
}

function userTexts(path: string): [string, string][] {
  const f = TagFile.createFromPath(path)
  try {
    const id3 = f.getTag(TagTypes.Id3v2, false) as Id3v2Tag
    return id3
      .getFramesByClassType<Id3v2UserTextInformationFrame>(
        Id3v2FrameClassType.UserTextInformationFrame,
      )
      .map((frame) => [frame.description, frame.text.join('/')])
  } finally {
    f.dispose()
  }
}

const deleting = (path: string, names: string[]) =>
  writeTags(path, emptyMetadata(), undefined, false, undefined, undefined, false, names)

// ID3 matches a TXXX by its description whatever the case, as ffmpeg and the inspector do,
// but the in-place delete only found the exact spelling, and only the first of two frames
// sharing it: the tag the DJ deleted was still in the file after the update.
describe.each(['mp3', 'aiff', 'wav'] as const)('an in-place %s update', (ext) => {
  it('deletes a TXXX the inspector named in another case', () => {
    const path = tagged(ext)
    deleting(path, ['VINYL CONDITION'])
    expect(userTexts(path)).toEqual(FOREIGN.filter(([name]) => name !== 'Vinyl Condition'))
  })

  it('deletes every TXXX sharing the description', () => {
    const path = tagged(ext)
    deleting(path, ['SESSION'])
    expect(userTexts(path)).toEqual(FOREIGN.filter(([name]) => name !== 'SESSION'))
  })
})
