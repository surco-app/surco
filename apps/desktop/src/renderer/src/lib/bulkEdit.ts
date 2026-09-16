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

export type GroupingTagState = 'all' | 'some' | 'none'

export function groupingTagState(tracks: TrackItem[], tag: string): GroupingTagState {
  const count = tracks.filter((t) => csvHas(t.meta.grouping ?? '', tag)).length
  if (count === 0) return 'none'
  return count === tracks.length ? 'all' : 'some'
}

export function toggleGroupingAll(
  tracks: TrackItem[],
  tag: string,
): { id: string; meta: { grouping: string } }[] {
  const removing = groupingTagState(tracks, tag) === 'all'
  return tracks
    .filter((t) => csvHas(t.meta.grouping ?? '', tag) === removing)
    .map((t) => ({ id: t.id, meta: { grouping: toggleCsv(t.meta.grouping ?? '', tag) } }))
}

export function groupingTags(presets: string[], tracks: TrackItem[]): string[] {
  const seen = new Set(presets)
  const extra = tracks
    .flatMap((t) => splitCsv(t.meta.grouping ?? ''))
    .filter((tag) => (seen.has(tag) ? false : seen.add(tag)))
  return [...presets, ...extra]
}
