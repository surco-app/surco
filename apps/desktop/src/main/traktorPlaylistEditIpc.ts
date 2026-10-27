import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { BrowserWindow, ipcMain } from 'electron'
import type { RekordboxEditResult, RekordboxPlaylistEdit } from '../shared/types'
import { serialLibraryFlush } from './libraryTagSync'
import { type QueueApply, type RekordboxQueue, withoutOp } from './rekordboxQueue'
import { type EditOp, editResultOfOutcome } from './rekordboxQueueOps'
import { stillWaiting } from './rekordboxQueueWatch'
import { traktorStamps } from './traktorPlaylistModel'
import { traktorSeparatorKey } from './traktorPlaylists'

// The twin of rekordbox:edit for Traktor: the edit joins the Traktor queue, applies at once
// when Traktor is closed, and otherwise waits for it to close. The collection is the one
// the DJ confirmed in Settings; without one there is nothing to edit.
export function registerTraktorPlaylistEditIpc(host: {
  collection: () => string
  queue: Pick<RekordboxQueue, 'apply' | 'drop'> & { enqueue: (ops: EditOp[]) => boolean }
  ensureClosed: (win: BrowserWindow | null) => Promise<boolean>
  onApplied?: (result: QueueApply) => void
  onWaiting?: () => void
}): void {
  ipcMain.handle('traktor:hasSeparator', () => {
    const path = host.collection()
    return path !== '' && traktorSeparatorKey(readFileSync(path, 'utf8')) !== null
  })
  ipcMain.handle('traktor:edit', (e, edit: RekordboxPlaylistEdit, label?: string) =>
    serialLibraryFlush(async (): Promise<RekordboxEditResult> => {
      const path = host.collection()
      if (!path) return { applied: false, reason: 'unreadable' }
      const stamp =
        edit.kind === 'create'
          ? undefined
          : traktorStamps(readFileSync(path, 'utf8'))[edit.playlistId]
      const op: EditOp = {
        id: randomUUID(),
        kind: 'edit',
        edit,
        stamps: edit.kind === 'create' || stamp === undefined ? {} : { [edit.playlistId]: stamp },
        ...(label ? { label } : {}),
      }
      host.queue.enqueue([op])
      const result = await host.queue.apply(() =>
        host.ensureClosed(BrowserWindow.fromWebContents(e.sender)),
      )
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
