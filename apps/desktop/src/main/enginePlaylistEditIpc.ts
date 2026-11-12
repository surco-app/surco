import { randomUUID } from 'node:crypto'
import type { DjEditMain } from '../shared/djApi'
import type { RekordboxEditResult, RekordboxPlaylistEdit } from '../shared/types'
import { engineDatabasePath } from './enginePlaylists'
import { serialLibraryFlush } from './libraryTagSync'
import { type QueueApply, type RekordboxQueue, withoutOp } from './rekordboxQueue'
import { type EditOp, editResultOfOutcome } from './rekordboxQueueOps'
import { stillWaiting } from './rekordboxQueueWatch'

export function engineEdit(host: {
  libraryDir: () => string
  queue: Pick<RekordboxQueue, 'apply' | 'drop' | 'outcomeOf'> & { enqueue: (ops: EditOp[]) => void }
  isRunning: () => Promise<boolean>
  onApplied?: (result: QueueApply) => void
  onWaiting?: () => void
  beginLoose?: (collectionPath: string) => void
}): DjEditMain {
  return {
    save: (edit: RekordboxPlaylistEdit, label: string | undefined) =>
      serialLibraryFlush(async (): Promise<RekordboxEditResult> => {
        const dir = host.libraryDir()
        if (!dir) return { applied: false, reason: 'unreadable' }
        const op: EditOp = {
          id: randomUUID(),
          kind: 'edit',
          edit,
          stamps: {},
          ...(label ? { label } : {}),
        }
        host.queue.enqueue([op])
        host.beginLoose?.(engineDatabasePath(dir))
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
