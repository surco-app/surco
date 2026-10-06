import type { LibraryTagUpdate, MusicFixOutcome } from '../../../shared/types'

export function tagUpdatesOf(
  outcomes: MusicFixOutcome[],
  direction: 'apply' | 'undo',
): LibraryTagUpdate[] {
  const updates: LibraryTagUpdate[] = []
  for (const o of outcomes) {
    if (!o.path || o.written.length === 0) continue
    const fields: LibraryTagUpdate['fields'] = {}
    for (const f of o.fixes) {
      if (!o.written.includes(f.field)) continue
      fields[f.field] =
        direction === 'apply' ? { from: f.from, to: f.to } : { from: f.to, to: f.from }
    }
    updates.push({ path: o.path, fields })
  }
  return updates
}
