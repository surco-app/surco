import type { TrackMetadata } from './types'

// The single source of truth for the complete set of metadata fields. A Record over
// `keyof TrackMetadata` must list every key, so adding a field to TrackMetadata without
// listing it here is a compile error — which is what keeps METADATA_KEYS (and the
// emptyMetadata() the editor's "Clear all metadata" relies on) exhaustive instead of
// drifting out of sync as new fields are added. The values are unused; only the keys are.
const FIELD_PRESENCE: Record<keyof TrackMetadata, true> = {
  title: true,
  artist: true,
  album: true,
  albumArtist: true,
  year: true,
  genre: true,
  grouping: true,
  comment: true,
  trackNumber: true,
  discNumber: true,
  bpm: true,
  key: true,
  publisher: true,
  catalogNumber: true,
  remixArtist: true,
  discogsReleaseId: true,
  rating: true,
  composer: true,
  isrc: true,
  mixName: true,
  originalYear: true,
  compilation: true,
}

// Every metadata field name, derived from the presence map above so the two can't drift.
export const METADATA_KEYS = Object.keys(FIELD_PRESENCE) as (keyof TrackMetadata)[]

// A blank metadata record with every field present and empty — the value "Clear all
// metadata" applies. Filled from METADATA_KEYS so it covers new fields automatically; the
// accumulator is a complete string record (every key required), which TrackMetadata's
// optional fields accept, so it needs no unsafe cast.
export function emptyMetadata(): TrackMetadata {
  const blank = {} as Record<keyof TrackMetadata, string>
  for (const key of METADATA_KEYS) blank[key] = ''
  return blank
}
