import { type Tag, File as TagFile } from 'node-taglib-sharp'
import type { MusicReviewField } from '../shared/types'

// Kept apart from musicFieldWrite so the analysis worker can load it without dragging in
// ffmpeg.ts, which pulls electron and the ffmpeg binaries into the worker thread.
export type FieldWrite = 'written' | 'unchanged'

export interface TagFieldChange {
  field: MusicReviewField
  from: string
  to: string
}

const same = (a: string, b: string): boolean => a.normalize('NFC') === b.normalize('NFC')

function setOne(tag: Tag, { field, from, to }: TagFieldChange): FieldWrite {
  switch (field) {
    case 'title':
      if (!same(tag.title ?? '', from)) return 'unchanged'
      tag.title = to
      return 'written'
    case 'album':
      if (!same(tag.album ?? '', from)) return 'unchanged'
      tag.album = to
      return 'written'
    case 'artist':
      if (tag.performers.length !== 1 || !same(tag.performers[0], from)) return 'unchanged'
      tag.performers = [to]
      return 'written'
    case 'albumArtist':
      if (tag.albumArtists.length !== 1 || !same(tag.albumArtists[0], from)) return 'unchanged'
      tag.albumArtists = [to]
      return 'written'
    case 'genre':
      if (tag.genres.length !== 1 || !same(tag.genres[0], from)) return 'unchanged'
      tag.genres = [to]
      return 'written'
  }
}

export function setTagFields(file: string, changes: TagFieldChange[]): FieldWrite[] {
  const f = TagFile.createFromPath(file)
  try {
    const outcomes = changes.map((change) => setOne(f.tag, change))
    if (outcomes.includes('written')) f.save()
    return outcomes
  } finally {
    f.dispose()
  }
}
