import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  Id3v2FrameIdentifier,
  type Id3v2Tag,
  Id3v2TextInformationFrame,
  File as TagFile,
  TagTypes,
} from 'node-taglib-sharp'
import { describe, expect, it } from 'vitest'
import { emptyMetadata } from '../shared/metadata'
import { withSeratoCues } from '../shared/seratoMarkers'
import { setSeratoMarkers } from './seratoTags'
import { encodeSine } from './sineTone.fixture'
import { setTagFields } from './tagFieldSet'
import { copyCueFrames, writeTags } from './tags'
import { buildTraktorTree, id3WithPriv, traktorCue } from './traktor4Fixture'

const dir = mkdtempSync(join(tmpdir(), 'surco-v23-sorts-'))
let n = 0

const SORTS = { TSOP: 'Beatles, The', TSOA: 'White Album, The', TSOT: 'Long Song, A' }

// The ID3v2.3 tag iTunes and mp3tag write: the sort names as plain v2.3 TSOP, TSOA and TSOT
// frames. Built through an identifier of our own so the fixture never depends on the fix.
function itunesTagged(ext: 'mp3' | 'aiff' | 'wav'): string {
  const path = encodeSine(dir, `itunes${n++}`, ext)
  const f = TagFile.createFromPath(path)
  const id3 = f.getTag(TagTypes.Id3v2, true) as Id3v2Tag
  id3.version = 3
  id3.title = 'Old title'
  for (const [id, text] of Object.entries(SORTS)) {
    const frame = Id3v2TextInformationFrame.fromIdentifier(
      new Id3v2FrameIdentifier(id, id, `TS${id[3]}`),
    )
    frame.text = [text]
    id3.addFrame(frame)
  }
  f.save()
  f.dispose()
  for (const id of Object.keys(SORTS)) expect(readFileSync(path).includes(id)).toBe(true)
  return path
}

function sorts(path: string): Record<string, string> {
  const f = TagFile.createFromPath(path)
  try {
    const id3 = f.getTag(TagTypes.Id3v2, false) as Id3v2Tag
    expect(id3.version).toBe(3)
    return { TSOP: id3.performersSort.join('/'), TSOA: id3.albumSort, TSOT: id3.titleSort }
  } finally {
    f.dispose()
  }
}

const traktorSource = (): string => {
  const path = join(dir, `traktor${n++}.mp3`)
  const audio = readFileSync(encodeSine(dir, `audio${n++}`, 'mp3'))
  writeFileSync(
    path,
    Buffer.concat([id3WithPriv(buildTraktorTree([traktorCue('Drop', 0, 1000, 0)])), audio]),
  )
  return path
}

// TagLib knows TSOP, TSOA and TSOT as ID3v2.4 frames only and left them out of every v2.3
// tag it saved, so any write Surco made to an iTunes-tagged file (a list fix, a Serato or
// Traktor cue, a tag update) cost the DJ the sort names Music and mp3tag order the library by.
describe.each(['mp3', 'aiff', 'wav'] as const)('an iTunes-tagged ID3v2.3 %s', (ext) => {
  it('keeps its sort names through any TagLib save', () => {
    const path = itunesTagged(ext)
    const f = TagFile.createFromPath(path)
    f.save()
    f.dispose()
    expect(sorts(path)).toEqual(SORTS)
  })

  it('keeps its sort names through a field fix from the list', () => {
    const path = itunesTagged(ext)
    expect(setTagFields(path, [{ field: 'title', from: 'Old title', to: 'New title' }])).toEqual([
      'written',
    ])
    expect(sorts(path)).toEqual(SORTS)
  })

  it('keeps its sort names through a Serato cue write', () => {
    const path = itunesTagged(ext)
    setSeratoMarkers(path, withSeratoCues(null, [{ index: 0, ms: 2000, color: 0, name: '' }]))
    expect(sorts(path)).toEqual(SORTS)
  })

  it('keeps its sort names through a tag update in place', () => {
    const path = itunesTagged(ext)
    writeTags(path, { ...emptyMetadata(), title: 'New title' })
    expect(sorts(path)).toEqual(SORTS)
  })

  // The inspector lists a TSOP by ffmpeg's name for it; once kept, a sort name the DJ
  // deleted there must still go, and only that one.
  it('drops only the sort name the DJ deleted in the inspector', () => {
    const path = itunesTagged(ext)
    writeTags(
      path,
      { ...emptyMetadata(), title: 'New title' },
      undefined,
      undefined,
      undefined,
      undefined,
      false,
      ['artist-sort'],
    )
    expect(sorts(path)).toEqual({ ...SORTS, TSOP: '' })
  })

  it('keeps its sort names through a Traktor cue carry', () => {
    const path = itunesTagged(ext)
    copyCueFrames(traktorSource(), path)
    expect(readFileSync(path).includes('TRAKTOR4')).toBe(true)
    expect(sorts(path)).toEqual(SORTS)
  })
})
