import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import type { LibraryTagSync, LibraryTagUpdate, MusicReviewField, TagChange } from '../shared/types'
import type { TagsOp } from './rekordboxQueueOps'
import type { SeratoTagField } from './seratoDatabaseWrite'
import { syncTagOps, type TagQueueDeps } from './seratoTagSync'
import type { VirtualdjRoot } from './virtualdjLibrary'
import { virtualdjHeld } from './virtualdjTrackWrite'

const FIELD: Partial<Record<MusicReviewField, SeratoTagField>> = {
  title: 'tsng',
  artist: 'tart',
  album: 'talb',
  genre: 'tgen',
}

export function virtualdjTagOps(updates: LibraryTagUpdate[], roots: VirtualdjRoot[]): TagsOp[] {
  const held = virtualdjHeld(roots)
  return updates.flatMap((update): TagsOp[] => {
    const fields: TagsOp['fields'] = {}
    const from: NonNullable<TagsOp['from']> = {}
    for (const [field, change] of Object.entries(update.fields) as [
      MusicReviewField,
      TagChange | undefined,
    ][]) {
      const tag = FIELD[field]
      if (!tag || !change) continue
      fields[tag] = change.to
      from[tag] = change.from
    }
    if (Object.keys(fields).length === 0 || !held(update.path)) return []
    return [
      {
        id: randomUUID(),
        kind: 'tags',
        path: update.path,
        label: basename(update.path),
        fields,
        from,
      },
    ]
  })
}

export async function syncVirtualdjTags(
  updates: LibraryTagUpdate[],
  deps: TagQueueDeps & { enabled: boolean; roots: () => VirtualdjRoot[] },
): Promise<LibraryTagSync> {
  if (!deps.enabled) return { outcome: 'nothing' }
  const roots = deps.roots()
  if (roots.length === 0) return { outcome: 'missing' }
  return syncTagOps(virtualdjTagOps(updates, roots), deps)
}
