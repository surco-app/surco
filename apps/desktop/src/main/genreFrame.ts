import {
  ByteVector,
  type Id3v2Frame,
  Id3v2FrameIdentifiers,
  type Id3v2Tag,
  Id3v2UnknownFrame,
  InfoTag,
  StringType,
  File as TagFile,
  TagTypes,
} from 'node-taglib-sharp'
import type { FieldWrite, TagFieldChange } from './tagFieldSet'
import { id3TextOf } from './tags'

function tconFrames(f: TagFile): { id3: Id3v2Tag; frames: Id3v2Frame[] } | null {
  const id3 = f.getTag(TagTypes.Id3v2, false) as Id3v2Tag | null
  if (id3?.version !== 3) return null
  const frames = id3.frames.filter((fr) => fr.frameId === Id3v2FrameIdentifiers.TCON)
  return frames.length > 0 ? { id3, frames } : null
}

const rawOf = (frame: Id3v2Frame): string => id3TextOf(frame.render(3).subarray(10).toByteArray())

export function readGenreFrame(file: string): { raw: string; info?: string } | null {
  const f = TagFile.createFromPath(file)
  try {
    const tcon = tconFrames(f)
    if (!tcon) return null
    const info = f.getTag(TagTypes.RiffInfo, false)
    const ignr =
      info instanceof InfoTag ? info.getValuesAsStrings('IGNR')[0]?.replace(/\0+$/, '') : undefined
    return { raw: rawOf(tcon.frames[0]), ...(ignr ? { info: ignr } : {}) }
  } finally {
    f.dispose()
  }
}

export function setGenreFrame(file: string, changes: TagFieldChange[]): FieldWrite[] {
  const f = TagFile.createFromPath(file)
  try {
    const tcon = tconFrames(f)
    const outcomes = changes.map(
      (c): FieldWrite =>
        c.field === 'genre' && tcon?.frames.every((fr) => rawOf(fr) === c.from)
          ? 'written'
          : 'unchanged',
    )
    const change = changes[outcomes.indexOf('written')]
    if (!tcon || !change) return outcomes
    const data = ByteVector.concatenate(
      StringType.UTF16,
      ByteVector.fromString(change.to, StringType.UTF16),
    )
    for (const frame of tcon.frames) tcon.id3.removeFrame(frame)
    tcon.id3.addFrame(Id3v2UnknownFrame.fromData(Id3v2FrameIdentifiers.TCON, data))
    f.save()
    return outcomes
  } finally {
    f.dispose()
  }
}
