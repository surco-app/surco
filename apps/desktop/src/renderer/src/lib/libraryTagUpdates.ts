import type {
  LibraryTagUpdate,
  MusicFieldOutcome,
  MusicReviewField,
  TagChange,
} from '../../../shared/types'

type Taken = {
  path?: string
  written: MusicReviewField[]
  fixes: ({ field: MusicReviewField } & TagChange)[]
  music: (MusicFieldOutcome | 'none')[]
}

function updatesOf(
  outcomes: Taken[],
  direction: 'apply' | 'undo',
  took: (o: Taken, index: number) => boolean,
): LibraryTagUpdate[] {
  const updates: LibraryTagUpdate[] = []
  for (const o of outcomes) {
    if (!o.path) continue
    const fields: LibraryTagUpdate['fields'] = {}
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

// The fields Music took: what the DJ libraries follow, the file written or not, since the
// user wants a track corrected in Music corrected in rekordbox, Engine DJ and Traktor too.
export const libraryUpdatesOf = (outcomes: Taken[], direction: 'apply' | 'undo') =>
  updatesOf(outcomes, direction, (o, i) => o.music[i] === 'set')
