import type {
  LibraryTagUpdate,
  MusicFieldOutcome,
  MusicReviewField,
  ReviewedFileUpdate,
  ReviewWriteField,
  TagChange,
} from '../../../shared/types'

type Taken = {
  path?: string
  written: ReviewWriteField[]
  fixes: ({ field: ReviewWriteField } & TagChange)[]
  music: (MusicFieldOutcome | 'none')[]
}

const LIBRARY_FIELDS: ReadonlySet<ReviewWriteField> = new Set<MusicReviewField>([
  'title',
  'artist',
  'albumArtist',
  'album',
  'genre',
])

function updatesOf(
  outcomes: Taken[],
  direction: 'apply' | 'undo',
  took: (o: Taken, index: number) => boolean,
): ReviewedFileUpdate[] {
  const updates: ReviewedFileUpdate[] = []
  for (const o of outcomes) {
    if (!o.path) continue
    const fields: ReviewedFileUpdate['fields'] = {}
    for (const [i, f] of o.fixes.entries()) {
      if (!took(o, i)) continue
      fields[f.field] =
        direction === 'apply' ? { from: f.from, to: f.to } : { from: f.to, to: f.from }
    }
    if (Object.keys(fields).length > 0) updates.push({ path: o.path, fields })
  }
  return updates
}

// The fields that reached the file: what the editor rereads.
export const tagUpdatesOf = (outcomes: Taken[], direction: 'apply' | 'undo') =>
  updatesOf(outcomes, direction, (o, i) => o.written.includes(o.fixes[i].field))

// The fields Music or the file took: what the DJ libraries follow, since the user wants a
// track corrected in Music corrected in rekordbox, Engine DJ and Traktor too, its file
// written or not, and a list track Music does not hold corrected there from its file.
export const libraryUpdatesOf = (
  outcomes: Taken[],
  direction: 'apply' | 'undo',
): LibraryTagUpdate[] =>
  updatesOf(
    outcomes,
    direction,
    (o, i) =>
      LIBRARY_FIELDS.has(o.fixes[i].field) &&
      (o.music[i] === 'set' || o.written.includes(o.fixes[i].field)),
  ) as LibraryTagUpdate[]
