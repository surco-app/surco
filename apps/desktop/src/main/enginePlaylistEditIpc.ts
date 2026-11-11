import { randomUUID } from 'node:crypto'
import { BrowserWindow, type WebContents } from 'electron'
import type { DjEditMain } from '../shared/djApi'
import type { PlaylistEditMode, RekordboxEditResult, RekordboxPlaylistEdit } from '../shared/types'
import { engineDatabasePath } from './enginePlaylists'
import { serialLibraryFlush } from './libraryTagSync'
import { type QueueApply, type RekordboxQueue, withoutOp } from './rekordboxQueue'
import { type EditOp, editResultOfOutcome } from './rekordboxQueueOps'
import { stillWaiting } from './rekordboxQueueWatch'

export function engineEdit(host: {
  libraryDir: () => string
  queue: Pick<RekordboxQueue, 'apply' | 'drop'> & { enqueue: (ops: EditOp[]) => void }
  isRunning: () => Promise<boolean>
  ensureClosed: (win: BrowserWindow | null) => Promise<boolean>
  onApplied?: (result: QueueApply) => void
  onWaiting?: () => void
  beginLoose?: (collectionPath: string) => void
}): DjEditMain {
  return {
    save: (
      edit: RekordboxPlaylistEdit,
      label: string | undefined,
      sender: WebContents,
      mode: PlaylistEditMode = 'ask',
    ) =>
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
        const result = await host.queue.apply(
          mode === 'queue'
            ? async () => !(await host.isRunning())
            : () => host.ensureClosed(BrowserWindow.fromWebContents(sender)),
        )
        if (result.status === 'applied') {
          const others = withoutOp(result, op.id)
          if (others.tracks > 0 || others.changes > 0 || others.notices.length > 0)
            host.onApplied?.(others)
        }
        if (stillWaiting(result)) {
          host.onWaiting?.()
          if (mode === 'queue') return { applied: false, queued: true, opId: op.id }
        } else if (result.status === 'refused') host.queue.drop(op.id)
        if (result.status === 'refused') return { applied: false, reason: result.reason }
        const outcome =
          result.status === 'applied' ? result.outcomes.find((o) => o.id === op.id) : undefined
        return editResultOfOutcome(outcome)
      }),
  }
}
