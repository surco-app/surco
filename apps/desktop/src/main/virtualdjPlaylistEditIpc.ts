import { randomUUID } from 'node:crypto'
import type { DjEditMain } from '../shared/djApi'
import type { RekordboxEditResult, RekordboxPlaylistEdit } from '../shared/types'
import { serialLibraryFlush } from './libraryTagSync'
import { applyEditOps } from './playlistEditApply'
import type { QueueApply, RekordboxQueue } from './rekordboxQueue'
import type { EditOp } from './rekordboxQueueOps'
import type { VirtualdjRoot } from './virtualdjLibrary'
import { badVirtualdjName, virtualdjEditFiles } from './virtualdjListsWrite'

export function virtualdjEdit(host: {
  roots: () => VirtualdjRoot[]
  queue: Pick<RekordboxQueue, 'applyNew' | 'drop' | 'outcomeOf'>
  isRunning: () => Promise<boolean>
  onApplied?: (result: QueueApply) => void
  onWaiting?: () => void
}): DjEditMain {
  return {
    save: (edit: RekordboxPlaylistEdit, label: string | undefined) =>
      serialLibraryFlush(async (): Promise<RekordboxEditResult> => {
        const roots = host.roots()
        if (badVirtualdjName(edit, roots)) return { applied: false, reason: 'bad-name' }
        const op: EditOp = {
          id: randomUUID(),
          kind: 'edit',
          edit,
          stamps: {},
          files: virtualdjEditFiles(edit, roots),
          ...(label ? { label } : {}),
        }
        return (await applyEditOps(host, [op]))[0]
      }),
  }
}
