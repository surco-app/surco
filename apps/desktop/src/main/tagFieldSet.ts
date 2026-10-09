import { extname } from 'node:path'
import {
  CombinedTag,
  type Id3v2Tag,
  InfoTag,
  type Tag,
  File as TagFile,
  TagTypes,
} from 'node-taglib-sharp'
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

// The INFO ids ffmpeg, Music and rekordbox read, each value a NUL-terminated string. TagLib
// reads album from DIRC and artist from ISTR, and takes IART as the album artist, so its own
// view of an INFO list reads a different file than the one every DJ program shows. TagLib's
// spellings are still checked and rewritten when present, since mp3tag and Surco's own
// writeTags put them there. No INFO id holds an album artist anyone reads.
const INFO_IDS: Record<MusicReviewField, string[]> = {
  title: ['INAM'],
  artist: ['IART', 'ISTR'],
  album: ['IPRD', 'DIRC'],
  albumArtist: [],
  genre: ['IGNR'],
}

const TAGLIB_INFO_ID: Record<MusicReviewField, string> = {
  title: 'INAM',
  artist: 'ISTR',
  album: 'DIRC',
  albumArtist: 'IART',
  genre: 'IGNR',
}

const infoValues = (tag: InfoTag, id: string): string[] =>
  tag
    .getValuesAsStrings(id)
    .map((v) => v.replace(/\0+$/, ''))
    .filter((v) => v !== '')

const heldIds = (tag: InfoTag, field: MusicReviewField): string[] =>
  INFO_IDS[field].filter((id) => infoValues(tag, id).length > 0)

function readValues(tag: Tag, field: MusicReviewField): string[][] {
  if (!(tag instanceof InfoTag)) return [valuesOf(tag, field)]
  return heldIds(tag, field).map((id) => infoValues(tag, id))
}

const firstHeld = (f: TagFile, field: MusicReviewField): string[] => {
  const tags = f.tag instanceof CombinedTag ? f.tag.tags : [f.tag]
  for (const tag of tags) {
    const held = readValues(tag, field).find((values) => values.length > 0)
    if (held) return held
  }
  return []
}

function assignInfo(tag: InfoTag, field: MusicReviewField, to: string): void {
  const held = heldIds(tag, field)
  const targets = held.length > 0 ? held : INFO_IDS[field].slice(0, 1)
  for (const id of targets) {
    const nul = tag.getValuesAsStrings(id)[0]?.endsWith('\0') ? '\0' : ''
    if (to === '') tag.removeValue(id)
    else tag.setValuesFromStrings(id, [to + nul])
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
  if (!matches(firstHeld(f, field), from)) return 'unchanged'
  for (const tag of onDiskTags(f)) {
    for (const values of readValues(tag, field)) {
      if (values.length > 0 && !matches(values, from)) return 'unchanged'
    }
  }
  const info = f.getTag(TagTypes.RiffInfo, false)
  if (info instanceof InfoTag) {
    const elsewhere = f.tagTypesOnDisk & ~(TagTypes.RiffInfo | TagTypes.Id3v1)
    if (INFO_IDS[field].length === 0 && !elsewhere) return 'unchanged'
    const taglibId = TAGLIB_INFO_ID[field]
    const before = info.getValues(taglibId)
    assign(f.tag, field, to)
    if (before.length > 0) info.setValues(taglibId, before)
    else info.removeValue(taglibId)
    assignInfo(info, field, to)
    return 'written'
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
