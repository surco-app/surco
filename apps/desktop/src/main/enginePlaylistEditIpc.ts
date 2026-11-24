import { randomUUID } from 'node:crypto'
import type { DjEditMain } from '../shared/djApi'
import type { RekordboxEditResult, RekordboxPlaylistEdit } from '../shared/types'
import { engineDatabasePath } from './enginePlaylists'
import { serialLibraryFlush } from './libraryTagSync'
import { applyEditOps } from './playlistEditApply'
import type { QueueApply, RekordboxQueue } from './rekordboxQueue'
import type { EditOp } from './rekordboxQueueOps'

export function engineEdit(host: {
  libraryDir: () => string
  queue: Pick<RekordboxQueue, 'applyNew' | 'drop' | 'outcomeOf'>
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
        return (await applyEditOps(host, [op], engineDatabasePath(dir)))[0]
      }),
  }
}
