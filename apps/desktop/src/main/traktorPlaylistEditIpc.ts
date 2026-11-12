import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { DjEditMain } from '../shared/djApi'
import type { RekordboxEditResult, RekordboxPlaylistEdit } from '../shared/types'
import { serialLibraryFlush } from './libraryTagSync'
import { type QueueApply, type RekordboxQueue, withoutOp } from './rekordboxQueue'
import { type EditOp, editResultOfOutcome } from './rekordboxQueueOps'
import { stillWaiting } from './rekordboxQueueWatch'
import { traktorStamps, traktorSubtreeStamps } from './traktorPlaylistModel'
import { traktorSeparatorKey } from './traktorPlaylists'

// The twin of the rekordbox edit for Traktor: the edit joins the Traktor queue, applies at once
// when Traktor is closed, and otherwise waits for it to close. The collection is the one
// the DJ confirmed in Settings; without one there is nothing to edit.
export function traktorEdit(host: {
  collection: () => string
  queue: Pick<RekordboxQueue, 'apply' | 'drop' | 'outcomeOf'> & { enqueue: (ops: EditOp[]) => void }
  isRunning: () => Promise<boolean>
  onApplied?: (result: QueueApply) => void
  onWaiting?: () => void
  beginLoose?: (collectionPath: string) => void
}): DjEditMain {
  return {
    hasSeparator: () => {
      const path = host.collection()
      return path !== '' && traktorSeparatorKey(readFileSync(path, 'utf8')) !== null
    },
    save: (edit: RekordboxPlaylistEdit, label: string | undefined) =>
      serialLibraryFlush(async (): Promise<RekordboxEditResult> => {
        const path = host.collection()
        if (!path) return { applied: false, reason: 'unreadable' }
        const stamp =
          edit.kind === 'create' || edit.kind === 'delete'
            ? undefined
            : traktorStamps(readFileSync(path, 'utf8'))[edit.playlistId]
        // A delete takes everything below the node, so a change anywhere in it refuses it.
        const stamps =
          edit.kind === 'delete'
            ? traktorSubtreeStamps(readFileSync(path, 'utf8'), edit.playlistId)
            : edit.kind === 'create' || stamp === undefined
              ? {}
              : { [edit.playlistId]: stamp }
        const op: EditOp = {
          id: randomUUID(),
          kind: 'edit',
          edit,
          stamps,
          ...(label ? { label } : {}),
        }
        host.queue.enqueue([op])
        host.beginLoose?.(path)
        const result = await host.queue.apply(async () => !(await host.isRunning()))
        if (result.status === 'applied') {
          const others = withoutOp(result, op.id)
          if (others.tracks > 0 || others.changes > 0 || others.notices.length > 0)
            host.onApplied?.(others)
        }
        if (stillWaiting(result)) {
          host.onWaiting?.()
          return { applied: false, queued: true, opId: op.id }
        } else if (result.status === 'refused') host.queue.drop(op.id)
        if (result.status === 'refused') return { applied: false, reason: result.reason }
        const written = host.queue.outcomeOf(op.id)
        const outcome =
          result.status === 'applied' ? result.outcomes.find((o) => o.id === op.id) : undefined
        return editResultOfOutcome(outcome ?? written)
      }),
  }
}
