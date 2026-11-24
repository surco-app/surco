import { randomUUID } from 'node:crypto'
import type { DjEditMain } from '../shared/djApi'
import type { RekordboxEditResult, RekordboxPlaylistEdit } from '../shared/types'
import { serialLibraryFlush } from './libraryTagSync'
import { applyEditOps } from './playlistEditApply'
import type { QueueApply, RekordboxQueue } from './rekordboxQueue'
import type { EditOp } from './rekordboxQueueOps'
import { seratoEditFiles, seratoNameTaken } from './seratoCrateEdits'
import { validCrateName } from './seratoCrateFile'
import type { SeratoLibraryRoot } from './seratoLibrary'
import { createSeratoDraft } from './seratoLibraryWrite'

function badName(edit: RekordboxPlaylistEdit, roots: SeratoLibraryRoot[]): boolean {
  if (edit.kind === 'moveNode') return seratoNameTaken(createSeratoDraft(), edit, roots)
  if (edit.kind !== 'create' && edit.kind !== 'rename') return false
  return !validCrateName(edit.name.trim()) || seratoNameTaken(createSeratoDraft(), edit, roots)
}

export function seratoEdit(host: {
  roots: () => SeratoLibraryRoot[]
  queue: Pick<RekordboxQueue, 'applyNew' | 'drop' | 'outcomeOf'>
  isRunning: () => Promise<boolean>
  onApplied?: (result: QueueApply) => void
  onWaiting?: () => void
}): DjEditMain {
  return {
    save: (edit: RekordboxPlaylistEdit, label: string | undefined) =>
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
        return (await applyEditOps(host, [op]))[0]
      }),
  }
}
