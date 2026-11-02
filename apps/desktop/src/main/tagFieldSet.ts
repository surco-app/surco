import { extname } from 'node:path'
import {
  CombinedTag,
  Id3v2Tag,
  InfoTag,
  Mpeg4AppleTag,
  Mpeg4BoxType,
  type Tag,
  File as TagFile,
  TagTypes,
  XiphComment,
} from 'node-taglib-sharp'
import { fullDateOf } from '../shared/tagFields'
import type { ReviewWriteField } from '../shared/types'
import {
  dropBrokenUfids,
  id3GroupingOf,
  keepGenreParentheses,
  setId3Date,
  setId3Grouping,
  toYear,
} from './tags'

// Kept apart from musicFieldWrite so the analysis worker can load it without dragging in
// ffmpeg.ts, which pulls electron and the ffmpeg binaries into the worker thread.
export type FieldWrite = 'written' | 'unchanged'

export interface TagFieldChange {
  field: ReviewWriteField
  from: string
  to: string
}

const same = (a: string, b: string): boolean => a.normalize('NFC') === b.normalize('NFC')

function valuesOf(tag: Tag, field: ReviewWriteField): string[] {
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
    case 'year':
      return tag.year ? [String(tag.year)] : []
    case 'grouping': {
      const grouping = tag instanceof Id3v2Tag ? id3GroupingOf(tag) : tag.grouping
      return grouping ? [grouping] : []
    }
  }
}

// The INFO ids ffmpeg, Music and rekordbox read, each value a NUL-terminated string. TagLib
// reads album from DIRC and artist from ISTR, and takes IART as the album artist, so its own
// view of an INFO list reads a different file than the one every DJ program shows. TagLib's
// spellings are still checked and rewritten when present, since mp3tag and Surco's own
// writeTags put them there. No INFO id holds an album artist anyone reads.
const INFO_IDS: Record<ReviewWriteField, string[]> = {
  title: ['INAM'],
  artist: ['IART', 'ISTR'],
  album: ['IPRD', 'DIRC'],
  albumArtist: [],
  genre: ['IGNR'],
  year: ['ICRD'],
  grouping: [],
}

const TAGLIB_INFO_ID: Partial<Record<ReviewWriteField, string>> = {
  title: 'INAM',
  artist: 'ISTR',
  album: 'DIRC',
  albumArtist: 'IART',
  genre: 'IGNR',
  year: 'ICRD',
}

const yearOf = (value: string): string => value.trim().match(/^\d{4}/)?.[0] ?? value.trim()

const infoValues = (tag: InfoTag, id: string): string[] =>
  tag
    .getValuesAsStrings(id)
    .map((v) => v.replace(/\0+$/, ''))
    .filter((v) => v !== '')

const heldIds = (tag: InfoTag, field: ReviewWriteField): string[] =>
  INFO_IDS[field].filter((id) => infoValues(tag, id).length > 0)

function readValues(tag: Tag, field: ReviewWriteField): string[][] {
  if (!(tag instanceof InfoTag)) return [valuesOf(tag, field)]
  return heldIds(tag, field).map((id) => infoValues(tag, id))
}

const firstHeld = (f: TagFile, field: ReviewWriteField): string[] => {
  const tags = f.tag instanceof CombinedTag ? f.tag.tags : [f.tag]
  for (const tag of tags) {
    const held = readValues(tag, field).find((values) => values.length > 0)
    if (held) return held
  }
  return []
}

function assignInfo(tag: InfoTag, field: ReviewWriteField, to: string): void {
  const held = heldIds(tag, field)
  const targets = held.length > 0 ? held : INFO_IDS[field].slice(0, 1)
  for (const id of targets) {
    const nul = tag.getValuesAsStrings(id)[0]?.endsWith('\0') ? '\0' : ''
    const value = field === 'year' ? yearOf(to) : to
    if (value === '') tag.removeValue(id)
    else tag.setValuesFromStrings(id, [value + nul])
  }
}

const matches = (field: ReviewWriteField, values: string[], from: string): boolean => {
  if (from === '') return values.length === 0
  if (values.length !== 1) return false
  return field === 'year' ? yearOf(values[0]) === yearOf(from) : same(values[0], from)
}

function assign(tag: Tag, field: ReviewWriteField, to: string): void {
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
    case 'year':
      tag.year = toYear(to)
      return
    case 'grouping':
      tag.grouping = to
      return
  }
}

function assignNative(f: TagFile, field: ReviewWriteField, to: string, ext: string): void {
  if (field !== 'year' && field !== 'grouping') return
  const id3 = f.getTag(TagTypes.Id3v2, false)
  if (id3 instanceof Id3v2Tag) {
    if (field === 'year') setId3Date(id3, to)
    else setId3Grouping(id3, to, ext)
  }
  const xiph = f.getTag(TagTypes.Xiph, false)
  if (field === 'year' && xiph instanceof XiphComment) {
    if (to.trim()) xiph.setFieldAsStrings('DATE', to)
    else xiph.removeField('DATE')
  }
  const apple = f.getTag(TagTypes.Apple, false)
  const date = fullDateOf(to)
  if (field === 'year' && date && apple instanceof Mpeg4AppleTag)
    apple.setQuickTimeString(Mpeg4BoxType.DAY, date)
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

function holds(f: TagFile, field: ReviewWriteField, value: string): boolean {
  if (!matches(field, firstHeld(f, field), value)) return false
  for (const tag of onDiskTags(f)) {
    for (const values of readValues(tag, field)) {
      if (values.length > 0 && !matches(field, values, value)) return false
    }
  }
  return true
}

function setOne(f: TagFile, { field, from, to }: TagFieldChange, ext: string): FieldWrite {
  if (!holds(f, field, from)) return 'unchanged'
  const info = f.getTag(TagTypes.RiffInfo, false)
  if (info instanceof InfoTag) {
    const elsewhere = f.tagTypesOnDisk & ~(TagTypes.RiffInfo | TagTypes.Id3v1)
    if (INFO_IDS[field].length === 0 && !elsewhere) return 'unchanged'
    const taglibId = TAGLIB_INFO_ID[field]
    const before = taglibId ? info.getValues(taglibId) : []
    assign(f.tag, field, to)
    if (taglibId && before.length > 0) info.setValues(taglibId, before)
    else if (taglibId) info.removeValue(taglibId)
    assignInfo(info, field, to)
    assignNative(f, field, to, ext)
    return 'written'
  }
  assign(f.tag, field, to)
  assignNative(f, field, to, ext)
  return 'written'
}

export function setTagFields(file: string, changes: TagFieldChange[]): FieldWrite[] {
  const f = TagFile.createFromPath(file)
  try {
    const outcomes = changes.map((change) => setOne(f, change, extname(file).toLowerCase()))
    if (!outcomes.includes('written')) return outcomes
    // The combined setter materializes a tag of every type the format could carry, and
    // save() writes them all: an MP3 with no ID3v1 gained one (the ghost of v0.99.6) and a
    // WAV with only an "id3 " chunk gained LIST INFO, MID and IDVX chunks. Only tags the
    // file already had are rewritten.
    f.removeTags(f.tagTypes & ~f.tagTypesOnDisk)
    const id3 = f.getTag(TagTypes.Id3v2, false) as Id3v2Tag | null
    if (id3 && extname(file).toLowerCase() === '.mp3') dropBrokenUfids(id3)
    if (id3) keepGenreParentheses(id3)
    f.save()
    return outcomes
  } finally {
    f.dispose()
  }
}

// Whether every tag on disk already says what each change asks for: Music, which rewrites
// its file as it sets the field, may have written the fix before Surco got to it.
export function tagFieldsHeld(file: string, changes: TagFieldChange[]): boolean[] {
  const f = TagFile.createFromPath(file)
  try {
    return changes.map(({ field, to }) => holds(f, field, to))
  } finally {
    f.dispose()
  }
}
