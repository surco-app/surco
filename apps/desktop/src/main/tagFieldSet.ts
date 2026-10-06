import { extname } from 'node:path'
import { type Id3v2Tag, type Tag, File as TagFile, TagTypes } from 'node-taglib-sharp'
import type { MusicReviewField } from '../shared/types'
import { dropBrokenUfids } from './tags'

// Kept apart from musicFieldWrite so the analysis worker can load it without dragging in
// ffmpeg.ts, which pulls electron and the ffmpeg binaries into the worker thread.
export type FieldWrite = 'written' | 'unchanged'

export interface TagFieldChange {
  field: MusicReviewField
  from: string
  to: string
}

const same = (a: string, b: string): boolean => a.normalize('NFC') === b.normalize('NFC')

function valuesOf(tag: Tag, field: MusicReviewField): string[] {
  switch (field) {
    case 'title':
      return tag.title ? [tag.title] : []
    case 'album':
      return tag.album ? [tag.album] : []
    case 'artist':
      return tag.performers
    case 'albumArtist':
      return tag.albumArtists
    case 'genre':
      return tag.genres
  }
}

const matches = (values: string[], from: string): boolean =>
  from === '' ? values.length === 0 : values.length === 1 && same(values[0], from)

function assign(tag: Tag, field: MusicReviewField, to: string): void {
  switch (field) {
    case 'title':
      tag.title = to
      return
    case 'album':
      tag.album = to
      return
    case 'artist':
      tag.performers = [to]
      return
    case 'albumArtist':
      tag.albumArtists = [to]
      return
    case 'genre':
      tag.genres = [to]
      return
  }
}

// The combined view answers with the first tag that has a value, so a WAV whose ID3 chunk
// says one thing and whose INFO list says another would pass on the ID3 alone and then
// have both overwritten. Every tag actually on disk has to agree with what the review saw,
// except ID3v1: a Latin-1 mirror cut to 30 characters, it can never match a long title or an
// accent, and comparing it would skip most MP3s. It is still rewritten when it exists.
function onDiskTags(f: TagFile): Tag[] {
  const tags: Tag[] = []
  for (let bit = 0; bit < 31; bit++) {
    const type = 1 << bit
    if (!(f.tagTypesOnDisk & type) || type === TagTypes.Id3v1) continue
    const tag = f.getTag(type, false)
    if (tag) tags.push(tag)
  }
  return tags
}

function setOne(f: TagFile, { field, from, to }: TagFieldChange): FieldWrite {
  if (!matches(valuesOf(f.tag, field), from)) return 'unchanged'
  for (const tag of onDiskTags(f)) {
    const values = valuesOf(tag, field)
    if (values.length > 0 && !matches(values, from)) return 'unchanged'
  }
  assign(f.tag, field, to)
  return 'written'
}

export function setTagFields(file: string, changes: TagFieldChange[]): FieldWrite[] {
  const f = TagFile.createFromPath(file)
  try {
    const outcomes = changes.map((change) => setOne(f, change))
    if (!outcomes.includes('written')) return outcomes
    // The combined setter materializes a tag of every type the format could carry, and
    // save() writes them all: an MP3 with no ID3v1 gained one (the ghost of v0.99.6) and a
    // WAV with only an "id3 " chunk gained LIST INFO, MID and IDVX chunks. Only tags the
    // file already had are rewritten.
    f.removeTags(f.tagTypes & ~f.tagTypesOnDisk)
    if (extname(file).toLowerCase() === '.mp3') {
      const id3 = f.getTag(TagTypes.Id3v2, false) as Id3v2Tag | null
      if (id3) dropBrokenUfids(id3)
    }
    f.save()
    return outcomes
  } finally {
    f.dispose()
  }
}
