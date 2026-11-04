import { randomUUID } from 'node:crypto'
import { ipcMain } from 'electron'
import type { RekordboxEditResult, RekordboxPlaylistEdit } from '../shared/types'
import { serialLibraryFlush } from './libraryTagSync'
import { type QueueApply, type RekordboxQueue, withoutOp } from './rekordboxQueue'
import { type EditOp, editResultOfOutcome } from './rekordboxQueueOps'
import { stillWaiting } from './rekordboxQueueWatch'
import { seratoEditFiles, seratoNameTaken } from './seratoCrateEdits'
import { validCrateName } from './seratoCrateFile'
import type { SeratoLibraryRoot } from './seratoLibrary'
import { createSeratoDraft } from './seratoLibraryWrite'

function badName(edit: RekordboxPlaylistEdit, roots: SeratoLibraryRoot[]): boolean {
  if (edit.kind !== 'create' && edit.kind !== 'rename') return false
  return !validCrateName(edit.name.trim()) || seratoNameTaken(createSeratoDraft(), edit, roots)
}

export function registerSeratoPlaylistEditIpc(host: {
  roots: () => SeratoLibraryRoot[]
  queue: Pick<RekordboxQueue, 'apply' | 'drop'> & { enqueue: (ops: EditOp[]) => void }
  isRunning: () => Promise<boolean>
  onApplied?: (result: QueueApply) => void
  onWaiting?: () => void
}): void {
  ipcMain.handle('serato:edit', (_e, edit: RekordboxPlaylistEdit, label?: string) =>
    serialLibraryFlush(async (): Promise<RekordboxEditResult> => {
      const roots = host.roots()
      if (badName(edit, roots)) return { applied: false, reason: 'bad-name' }
      const op: EditOp = {
        id: randomUUID(),
        kind: 'edit',
        edit,
        stamps: {},
        files: seratoEditFiles(edit, roots),
        ...(label ? { label } : {}),
      }
      host.queue.enqueue([op])
      const result = await host.queue.apply(async () => !(await host.isRunning()))
      if (result.status === 'applied') {
        const others = withoutOp(result, op.id)
        if (others.tracks > 0 || others.changes > 0 || others.notices.length > 0)
          host.onApplied?.(others)
      }
      if (stillWaiting(result)) host.onWaiting?.()
      else if (result.status === 'refused') host.queue.drop(op.id)
      if (result.status === 'refused') return { applied: false, reason: result.reason }
      const outcome =
        result.status === 'applied' ? result.outcomes.find((o) => o.id === op.id) : undefined
      return editResultOfOutcome(outcome)
    }),
  )
}
