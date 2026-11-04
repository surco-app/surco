import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import type { LibraryTagSync, LibraryTagUpdate, MusicReviewField, TagChange } from '../shared/types'
import type { QueueApply, RekordboxQueue } from './rekordboxQueue'
import type { TagsOp } from './rekordboxQueueOps'
import { stillWaiting } from './rekordboxQueueWatch'
import { seratoLibraryHas } from './seratoCrateEdits'
import { seratoRootOf } from './seratoCrateFile'
import type { SeratoTagField } from './seratoDatabaseWrite'
import type { SeratoLibraryRoot } from './seratoLibrary'

const SERATO_FIELD: Partial<Record<MusicReviewField, SeratoTagField>> = {
  title: 'tsng',
  artist: 'tart',
  album: 'talb',
  genre: 'tgen',
}

export function seratoTagOps(updates: LibraryTagUpdate[], roots: SeratoLibraryRoot[]): TagsOp[] {
  const has = seratoLibraryHas(roots)
  return updates.flatMap((update): TagsOp[] => {
    const fields: TagsOp['fields'] = {}
    const from: NonNullable<TagsOp['from']> = {}
    for (const [field, change] of Object.entries(update.fields) as [
      MusicReviewField,
      TagChange | undefined,
    ][]) {
      const tag = SERATO_FIELD[field]
      if (!tag || !change) continue
      fields[tag] = change.to
      from[tag] = change.from
    }
    if (Object.keys(fields).length === 0) return []
    if (!seratoRootOf(update.path, roots) || !has(update.path)) return []
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

export async function syncSeratoTags(
  updates: LibraryTagUpdate[],
  deps: {
    enabled: boolean
    roots: () => SeratoLibraryRoot[]
    queue: Pick<RekordboxQueue, 'enqueue' | 'apply' | 'drop'>
    isRunning: () => Promise<boolean>
    onWaiting: () => void
    onApplied: (result: QueueApply) => void
  },
): Promise<LibraryTagSync> {
  if (!deps.enabled) return { outcome: 'nothing' }
  const roots = deps.roots()
  if (roots.length === 0) return { outcome: 'missing' }
  const ops = seratoTagOps(updates, roots)
  if (ops.length === 0) return { outcome: 'nothing' }
  deps.queue.enqueue(ops)
  let result: QueueApply
  try {
    result = await deps.queue.apply(async () => !(await deps.isRunning()))
  } catch (err) {
    for (const op of ops) deps.queue.drop(op.id)
    throw err
  }
  if (stillWaiting(result)) {
    deps.onWaiting()
    return { outcome: 'queued' }
  }
  if (result.status === 'refused') {
    for (const op of ops) deps.queue.drop(op.id)
    return { outcome: 'failed' }
  }
  if (result.status !== 'applied') return { outcome: 'nothing' }
  const own = new Set(ops.map((op) => op.id))
  const count = result.outcomes.filter((o) => o.applied && own.has(o.id)).length
  const mine = result.outcomes.filter((o) => own.has(o.id))
  const others: QueueApply = {
    ...result,
    tracks: Math.max(0, result.tracks - count),
    notices: result.notices.filter((n) => !mine.some((o) => o.notices.includes(n))),
    outcomes: result.outcomes.filter((o) => !own.has(o.id)),
  }
  if (others.tracks > 0 || others.changes > 0 || others.notices.length > 0) deps.onApplied(others)
  return count > 0 ? { outcome: 'updated', count } : { outcome: 'nothing' }
}
