import { clipboard, ipcMain, shell } from 'electron'
import log from 'electron-log/main'

// The OS pass-throughs (reveal/open/trash + plain clipboard text), split out of
// index.ts's registerIpc by domain: one-liners with no app state at all.
export function registerShellIpc(): void {
  ipcMain.handle('shell:reveal', (_e, path: string) => shell.showItemInFolder(path))
  ipcMain.handle('shell:open', (_e, path: string) => shell.openPath(path))
  // trashItem sends to the OS Trash / Recycle Bin (recoverable), never a hard delete.
  ipcMain.handle('shell:trash', (_e, path: string) => shell.trashItem(path))
  ipcMain.handle('clipboard:write', (_e, text: string) => clipboard.writeText(text))
  // The log path is resolved here (not sent by the renderer) so this can't be
  // used to reveal arbitrary files.
  ipcMain.handle('log:reveal', () => shell.showItemInFolder(log.transports.file.getFile().path))
}
