import type { TrackMetadata } from '../../../shared/types'
import type { TrackItem } from '../types'
import { csvHas, splitCsv, toggleCsv } from './csv'

// The release-level fields, the ones every track on an album shares, so setting one
// across a multi-selection is meaningful. Per-track fields (title, trackNumber, bpm,
// key, comment, remixArtist) are deliberately excluded: applying one value to all
// would overwrite genuinely different data rather than fill in a shared blank.
export const BULK_FIELDS: (keyof TrackMetadata)[] = [
  'artist',
  'albumArtist',
  'album',
  'year',
  'genre',
  'grouping',
  'composer',
  'originalYear',
  'compilation',
  'publisher',
  'catalogNumber',
  'discNumber',
]

// The value every selected track shares for a field, or undefined when they disagree.
// The bulk panel shows the shared value in the input and a "multiple values" hint when
// it is undefined, so an edit only overwrites the field the user actually touches.
// Optional fields read undefined when unset — folded to '' so a field no track
// carries shows as a shared blank, not as mixed.
export function commonValue(tracks: TrackItem[], key: keyof TrackMetadata): string | undefined {
  if (tracks.length === 0) return undefined
  const first = tracks[0].meta[key] ?? ''
  return tracks.every((t) => (t.meta[key] ?? '') === first) ? first : undefined
}

// A text field that holds several tags: which field, and what separates them.
export interface TagList {
  key: 'grouping' | 'genre'
  sep: ',' | ';'
}

export const GROUPING_TAGS: TagList = { key: 'grouping', sep: ',' }

// Semicolons, not commas: Discogs names a genre "Folk, World, & Country", which a comma
// split would break into three tags. Apple Music keeps the field as one text either way.
export const GENRE_TAGS: TagList = { key: 'genre', sep: ';' }

export type TagListState = 'all' | 'some' | 'none'

export function tagListState(tracks: TrackItem[], list: TagList, tag: string): TagListState {
  const count = tracks.filter((t) => csvHas(t.meta[list.key] ?? '', tag, list.sep)).length
  if (count === 0) return 'none'
  return count === tracks.length ? 'all' : 'some'
}

export function toggleTagListAll(
  tracks: TrackItem[],
  list: TagList,
  tag: string,
): { id: string; meta: Partial<TrackMetadata> }[] {
  const removing = tagListState(tracks, list, tag) === 'all'
  return tracks
    .filter((t) => csvHas(t.meta[list.key] ?? '', tag, list.sep) === removing)
    .map((t) => ({
      id: t.id,
      meta: { [list.key]: toggleCsv(t.meta[list.key] ?? '', tag, list.sep) },
    }))
}

export function tagListTags(presets: string[], tracks: TrackItem[], list: TagList): string[] {
  const seen = new Set(presets)
  const extra = tracks
    .flatMap((t) => splitCsv(t.meta[list.key] ?? '', list.sep))
    .filter((tag) => (seen.has(tag) ? false : seen.add(tag)))
  return [...presets, ...extra]
}
