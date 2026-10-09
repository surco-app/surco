import type { LibraryTagUpdate, MusicFixOutcome } from '../../../shared/types'

function updatesOf(
  outcomes: MusicFixOutcome[],
  direction: 'apply' | 'undo',
  took: (o: MusicFixOutcome, index: number) => boolean,
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
export const tagUpdatesOf = (outcomes: MusicFixOutcome[], direction: 'apply' | 'undo') =>
  updatesOf(outcomes, direction, (o, i) => o.written.includes(o.fixes[i].field))

// The fields Music took: what the DJ libraries follow, the file written or not, since the
// user wants a track corrected in Music corrected in rekordbox, Engine DJ and Traktor too.
export const libraryUpdatesOf = (outcomes: MusicFixOutcome[], direction: 'apply' | 'undo') =>
  updatesOf(outcomes, direction, (o, i) => o.music[i] === 'set')
