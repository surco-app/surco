import { BrowserWindow, ipcMain } from 'electron'
import type { DjProgram, ProgramCopies, RestoreResult } from '../shared/types'
import { listCopies, restoreSlot } from './libraryHistory'
import { restoreCopy } from './libraryRestore'
import type { SessionBackup } from './rekordboxSessionBackup'

export interface CopiesProgram {
  collectionPath: () => string | null
  untouched: () => boolean
  session: SessionBackup
  queue: {
    state: () => { tracks: number; changes: number; halted?: true }
    discard: () => void
  }
  ensureClosed: (win: BrowserWindow | null) => Promise<boolean>
  isRunning: () => Promise<boolean>
  pendingLog: (collectionPath: string) => boolean
}

const ORDER: DjProgram[] = ['rekordbox', 'traktor', 'engine']

export function registerCopiesIpc(
  programs: Record<DjProgram, CopiesProgram>,
  broadcast: (channel: string, payload: unknown) => void,
): void {
  ipcMain.handle('copies:status', async (): Promise<ProgramCopies[]> => {
    const found: ProgramCopies[] = []
    for (const program of ORDER) {
      const deps = programs[program]
      const collectionPath = deps.collectionPath()
      if (!collectionPath) continue
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
    async (e, program: DjProgram, copyId: string): Promise<RestoreResult> => {
      const deps = programs[program]
      const collectionPath = deps?.collectionPath()
      if (!deps || !collectionPath) return { ok: false, reason: 'not-found' }
      const win = BrowserWindow.fromWebContents((e as { sender: Electron.WebContents }).sender)
      try {
        return await restoreCopy(
          { collectionPath, copyId },
          {
            ensureClosed: () => deps.ensureClosed(win),
            isRunning: deps.isRunning,
            pendingLog: deps.pendingLog,
            discardQueue: deps.queue.discard,
          },
        )
      } finally {
        broadcast('copies:changed', null)
      }
    },
  )
}
