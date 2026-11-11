import { BrowserWindow, type IpcMainInvokeEvent, ipcMain } from 'electron'
import log from 'electron-log/main'
import { WRITABLE_PROGRAMS } from '../shared/djProgram'
import type { LibraryCopy, ProgramCopies, RestoreResult, WritableProgram } from '../shared/types'
import { listCopies, recoverRestoreSlot, restoreSlot } from './libraryHistory'
import { type RestoreDeps, restoreCopy } from './libraryRestore'
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
  history?: {
    list: () => { copies: LibraryCopy[]; restore: LibraryCopy | null }
    restore: (
      copyId: string,
      deps: Pick<RestoreDeps, 'ensureClosed' | 'isRunning' | 'discardQueue' | 'busy'>,
    ) => Promise<RestoreResult>
  }
}

const ORDER = WRITABLE_PROGRAMS

export function registerCopiesIpc(
  programs: Record<WritableProgram, CopiesProgram>,
  broadcast: (channel: string, payload: unknown) => void,
  converting: () => boolean,
): void {
  const recover = (program: WritableProgram, collectionPath: string) =>
    serialLibraryFlush(() =>
      programs[program].exclusive(collectionPath, () => recoverRestoreSlot(collectionPath)),
    ).catch((err) =>
      log.warn(`undo copy of ${collectionPath} could not be recovered: ${String(err)}`),
    )
  for (const program of ORDER) {
    const collectionPath = programs[program].collectionPath()
    if (collectionPath && !programs[program].history) void recover(program, collectionPath)
  }
  ipcMain.handle('copies:status', async (): Promise<ProgramCopies[]> => {
    const found: ProgramCopies[] = []
    for (const program of ORDER) {
      const deps = programs[program]
      const collectionPath = deps.collectionPath()
      if (!collectionPath) continue
      const own = deps.history?.list()
      if (!own) await recover(program, collectionPath)
      const queue = deps.queue.state()
      found.push({
        program,
        collectionPath,
        copies: own ? own.copies : await listCopies(collectionPath),
        restore: own ? own.restore : await restoreSlot(collectionPath),
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
    (e: IpcMainInvokeEvent, program: WritableProgram, copyId: string): Promise<RestoreResult> =>
      serialLibraryFlush(async () => {
        const deps = programs[program]
        const collectionPath = deps?.collectionPath()
        if (!deps || !collectionPath) return { ok: false, reason: 'not-found' }
        if (converting()) return { ok: false, reason: 'busy' }
        const win = BrowserWindow.fromWebContents(e.sender)
        const discardQueue = () => {
          deps.queue.discardCurrent()
          deps.onDiscarded?.()
        }
        const history = deps.history
        try {
          if (history)
            return await deps.exclusive(collectionPath, () =>
              history.restore(copyId, {
                ensureClosed: () => deps.ensureClosed(win),
                isRunning: deps.isRunning,
                discardQueue,
                busy: converting,
              }),
            )
          return await restoreCopy(
            { collectionPath, copyId },
            {
              ensureClosed: () => deps.ensureClosed(win),
              isRunning: deps.isRunning,
              pendingLog: deps.pendingLog,
              discardQueue,
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
