import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { DjEditMain } from '../shared/djApi'
import type { RekordboxEditResult, RekordboxPlaylistEdit } from '../shared/types'
import { serialLibraryFlush } from './libraryTagSync'
import { applyEditOps } from './playlistEditApply'
import type { QueueApply, RekordboxQueue } from './rekordboxQueue'
import type { EditOp } from './rekordboxQueueOps'
import { traktorStamps, traktorSubtreeStamps } from './traktorPlaylistModel'
import { readTraktor } from './worker'

// The twin of the rekordbox edit for Traktor: the edit joins the Traktor queue, applies at once
// when Traktor is closed, and otherwise waits for it to close. The collection is the one
// the DJ confirmed in Settings; without one there is nothing to edit.
export function traktorEdit(host: {
  collection: () => string
  queue: Pick<RekordboxQueue, 'applyNew' | 'drop' | 'outcomeOf'>
  isRunning: () => Promise<boolean>
  onApplied?: (result: QueueApply) => void
  onWaiting?: () => void
  beginLoose?: (collectionPath: string) => void
}): DjEditMain {
  return {
    hasSeparator: () => readTraktor(host.collection(), '', 'hasSeparator', undefined),
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
        return (await applyEditOps(host, [op], path))[0]
      }),
  }
}
