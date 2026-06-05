import type { TrackMetadata } from '../../../shared/types'
import type { TrackItem } from '../types'

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
  'publisher',
  'catalogNumber',
  'discNumber',
]

// The value every selected track shares for a field, or undefined when they disagree.
// The bulk panel shows the shared value in the input and a "multiple values" hint when
// it is undefined, so an edit only overwrites the field the user actually touches.
export function commonValue(tracks: TrackItem[], key: keyof TrackMetadata): string | undefined {
  if (tracks.length === 0) return undefined
  const first = tracks[0].meta[key]
  return tracks.every((t) => t.meta[key] === first) ? first : undefined
}
