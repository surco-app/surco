import type { MetaTextKey, TrackMetadata } from '../../../shared/types'
import type { TrackItem } from '../types'
import { csvHas, splitCsv, toggleCsv } from './csv'

// The release-level fields, the ones every track on an album shares, so setting one
// across a multi-selection is meaningful, plus Comment, which a batch of downloads shares
// as a site's note to wipe. Per-track fields (title, trackNumber, bpm, key, remixArtist,
// mixName, originalArtist, lyricist, conductor, encodedBy, isrc, mood, energy, quality)
// are deliberately excluded: applying one value to all would overwrite genuinely
// different data rather than fill in a shared blank.
export const BULK_FIELDS: MetaTextKey[] = [
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
  'trackTotal',
  'comment',
  'style',
  'discTotal',
  'copyright',
  'country',
  'mediaType',
  'discogsReleaseId',
  'discogsUrl',
]

// The value every selected track shares for a field, or undefined when they disagree.
// The bulk panel shows the shared value in the input and a "multiple values" hint when
// it is undefined, so an edit only overwrites the field the user actually touches.
// Optional fields read undefined when unset — folded to '' so a field no track
// carries shows as a shared blank, not as mixed.
export function commonValue(tracks: TrackItem[], key: MetaTextKey): string | undefined {
  if (tracks.length === 0) return undefined
  const first = tracks[0].meta[key] ?? ''
  return tracks.every((t) => (t.meta[key] ?? '') === first) ? first : undefined
}

// A text field that holds several tags, the tag names that contain a comma themselves and
// must stay whole, and what joins the tags (a comma when unset).
export interface TagList {
  key: 'grouping' | 'genre'
  whole?: readonly string[]
  separator?: string
}

export const GROUPING_TAGS: TagList = { key: 'grouping' }

// Discogs names one genre "Folk, World, & Country": split on its commas it would become
// three tags. Apple Music keeps the field as one text either way.
export const GENRE_TAGS: TagList = { key: 'genre', whole: ['Folk, World, & Country'] }

export type TagListState = 'all' | 'some' | 'none'

export function tagListState(tracks: TrackItem[], list: TagList, tag: string): TagListState {
  const count = tracks.filter((t) =>
    csvHas(t.meta[list.key] ?? '', tag, list.whole, list.separator),
  ).length
  if (count === 0) return 'none'
  return count === tracks.length ? 'all' : 'some'
}

export interface TagListStates {
  (tag: string): TagListState
  count: (tag: string) => number
}

export function tagsOf(track: TrackItem, list: TagList): Set<string> {
  return new Set(
    splitCsv(track.meta[list.key] ?? '', list.whole, list.separator).map((tag) =>
      tag.toLowerCase(),
    ),
  )
}

export function tagListStates(tracks: TrackItem[], list: TagList): TagListStates {
  const counts = new Map<string, number>()
  for (const track of tracks)
    for (const tag of tagsOf(track, list)) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  const count = (tag: string): number => counts.get(tag.toLowerCase()) ?? 0
  const stateOf = (tag: string): TagListState => {
    const carrying = count(tag)
    if (carrying === 0) return 'none'
    return carrying === tracks.length ? 'all' : 'some'
  }
  return Object.assign(stateOf, { count })
}

export function toggleTagListAll(
  tracks: TrackItem[],
  list: TagList,
  tag: string,
): { id: string; meta: Partial<TrackMetadata> }[] {
  const removing = tagListState(tracks, list, tag) === 'all'
  return tracks
    .filter((t) => csvHas(t.meta[list.key] ?? '', tag, list.whole, list.separator) === removing)
    .map((t) => ({
      id: t.id,
      meta: { [list.key]: toggleCsv(t.meta[list.key] ?? '', tag, list.whole, list.separator) },
    }))
}

export function tagListTags(presets: string[], tracks: TrackItem[], list: TagList): string[] {
  const seen = new Set(presets.map((tag) => tag.toLowerCase()))
  const extra = tracks
    .flatMap((t) => splitCsv(t.meta[list.key] ?? '', list.whole, list.separator))
    .filter((tag) => (seen.has(tag.toLowerCase()) ? false : seen.add(tag.toLowerCase())))
  return [...presets, ...extra]
}
