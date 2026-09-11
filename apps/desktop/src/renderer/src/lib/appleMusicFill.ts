import type { AppleMusicTrackMeta, TrackMetadata } from '../../../shared/types'

// The fields Music supplies verbatim. The rating is handled apart, below: Music scales
// stars 0-100 while the tag holds "1"-"5", so carrying its number through would write an
// 80-star rating into the file.
const FILLABLE = [
  'grouping',
  'year',
  'comment',
  'trackNumber',
  'discNumber',
  'bpm',
] as const satisfies readonly (keyof TrackMetadata & keyof AppleMusicTrackMeta)[]

// Music's 0-100 scale is Engine DJ's (see starsTagToEngineRating), 20 points per star.
function ratingToStarsTag(rating: number): string {
  return String(Math.max(1, Math.min(5, Math.round(rating / 20))))
}

// Fills the gaps the file leaves with what the Music database holds. The file wins wherever
// both carry a value: it is what the user's other tools read, and an import must not quietly
// rewrite a tag they can see in every other app.
//
// This exists because an Apple Music import is not a pile of loose files — it is a
// collection the user has already organised. Measured on a real library: the WAVs carry
// title/artist/album/year/genre and nothing else, while Music holds the grouping the user
// filed them under.
//
// Returns the original object when nothing was added, so an import does not churn state for
// tracks that had nothing to gain.
export function fillFromAppleMusic(meta: TrackMetadata, from: AppleMusicTrackMeta): TrackMetadata {
  let filled: TrackMetadata | undefined
  for (const key of FILLABLE) {
    const value = from[key]
    if (!value) continue
    if (meta[key]?.trim()) continue
    filled ??= { ...meta }
    filled[key] = value
  }
  // Only a rating the user gave in Music reaches here: the read side already drops the one
  // Music computes for itself, which would otherwise stamp stars on a whole library.
  if (from.rating !== undefined && !meta.rating?.trim()) {
    filled ??= { ...meta }
    filled.rating = ratingToStarsTag(from.rating)
  }
  return filled ?? meta
}
