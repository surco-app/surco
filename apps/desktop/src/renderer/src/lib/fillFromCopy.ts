import type { TrackMetadata } from '../../../shared/types'
import type { TrackItem } from '../types'

const KEPT_FROM_FILE = new Set(['title', 'artist', 'encodedBy', 'custom'])

const isBlank = (value: unknown): boolean => typeof value !== 'string' || value.trim() === ''

export function fillFromCopy(meta: TrackMetadata, copy: TrackMetadata): TrackMetadata | null {
  const filled: Record<string, unknown> = { ...meta }
  let changed = false
  for (const [key, value] of Object.entries(copy)) {
    if (KEPT_FROM_FILE.has(key) || isBlank(value) || !isBlank(filled[key])) continue
    filled[key] = value
    changed = true
  }
  const custom = { ...meta.custom }
  for (const [key, value] of Object.entries(copy.custom ?? {})) {
    if (isBlank(value) || !isBlank(custom[key])) continue
    custom[key] = value
    changed = true
  }
  if (!changed) return null
  return { ...(filled as unknown as TrackMetadata), ...(copy.custom ? { custom } : {}) }
}

// Another version of the track was filed by the DJ under the same grouping, but its album,
// year or label belong to that other release, so the grouping is all it lends.
export function groupingFromCopy(meta: TrackMetadata, copy: TrackMetadata): TrackMetadata | null {
  if (isBlank(copy.grouping) || !isBlank(meta.grouping)) return null
  return { ...meta, grouping: copy.grouping }
}

// The copy's artwork is the one the DJ sees for this track in their library, so it wins over
// the file's own and over a match's. The file's art stays in the picker as embeddedCover and
// ⌘Z takes the change back. Only a cover removed by hand stays removed.
export function copyCoverWins(
  item: Pick<TrackItem, 'coverUrl' | 'coverRemoved'>,
  cover: string,
): boolean {
  return !item.coverRemoved && cover !== item.coverUrl
}
