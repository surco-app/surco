import { BrowserWindow, type IpcMainInvokeEvent, ipcMain } from 'electron'
import log from 'electron-log/main'
import type { DjProgram, ProgramCopies, RestoreResult } from '../shared/types'
import { listCopies, recoverRestoreSlot, restoreSlot } from './libraryHistory'
import { restoreCopy } from './libraryRestore'
import { serialLibraryFlush } from './libraryTagSync'
import type { SessionBackup } from './rekordboxSessionBackup'

export interface CopiesProgram {
  collectionPath: () => string | null
  untouched: () => boolean
  session: SessionBackup
  queue: {
    state: () => { tracks: number; changes: number; halted?: true }
    discardCurrent: () => void
  }
  ensureClosed: (win: BrowserWindow | null) => Promise<boolean>
  isRunning: () => Promise<boolean>
  pendingLog: (collectionPath: string) => boolean
  exclusive: <T>(collectionPath: string, task: () => Promise<T>) => Promise<T>
  // The waiting queue a restore discarded, for the tracks held pending on it.
  onDiscarded?: () => void
}

const ORDER: DjProgram[] = ['rekordbox', 'traktor', 'engine']

export function registerCopiesIpc(
  programs: Record<DjProgram, CopiesProgram>,
  broadcast: (channel: string, payload: unknown) => void,
  converting: () => boolean,
): void {
  const recover = (program: DjProgram, collectionPath: string) =>
    serialLibraryFlush(() =>
      programs[program].exclusive(collectionPath, () => recoverRestoreSlot(collectionPath)),
    ).catch((err) =>
      log.warn(`undo copy of ${collectionPath} could not be recovered: ${String(err)}`),
    )
  for (const program of ORDER) {
    const collectionPath = programs[program].collectionPath()
    if (collectionPath) void recover(program, collectionPath)
  }
  ipcMain.handle('copies:status', async (): Promise<ProgramCopies[]> => {
    const found: ProgramCopies[] = []
    for (const program of ORDER) {
      const deps = programs[program]
      const collectionPath = deps.collectionPath()
      if (!collectionPath) continue
      await recover(program, collectionPath)
      const queue = deps.queue.state()
      found.push({
        program,
        collectionPath,
        copies: await listCopies(collectionPath),
        restore: await restoreSlot(collectionPath),
        pending: queue.tracks + queue.changes,
        halted: queue.halted === true,
        copyFailed: deps.session.failed().has(collectionPath),
        untouched: deps.untouched(),
      })
    }
    return found
  })

  ipcMain.handle(
    'copies:restore',
    (e: IpcMainInvokeEvent, program: DjProgram, copyId: string): Promise<RestoreResult> =>
      serialLibraryFlush(async () => {
        const deps = programs[program]
        const collectionPath = deps?.collectionPath()
        if (!deps || !collectionPath) return { ok: false, reason: 'not-found' }
        if (converting()) return { ok: false, reason: 'busy' }
        const win = BrowserWindow.fromWebContents(e.sender)
        try {
          return await restoreCopy(
            { collectionPath, copyId },
            {
              ensureClosed: () => deps.ensureClosed(win),
              isRunning: deps.isRunning,
              pendingLog: deps.pendingLog,
              discardQueue: () => {
                deps.queue.discardCurrent()
                deps.onDiscarded?.()
              },
              busy: converting,
              exclusive: (task) => deps.exclusive(collectionPath, task),
            },
          )
        } finally {
          broadcast('copies:changed', null)
        }
      }),
  )
}
