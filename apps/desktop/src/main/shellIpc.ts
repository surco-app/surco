import { clipboard, ipcMain, shell } from 'electron'
import log from 'electron-log/main'
import type { MediaAccess } from './mediaAccess'

// The OS pass-throughs (reveal/open/trash + plain clipboard text), split out of
// index.ts's registerIpc by domain. shell:open/trash/reveal take a
// renderer-supplied path straight into an OS call — a compromised renderer could
// otherwise trash or launch any file the OS user can touch, not just a track this
// app actually knows about. mediaAccess already tracks every path the app has
// handed the renderer as a real track or conversion output (see mediaAccess.ts),
// so it doubles as the allowlist here.
export function registerShellIpc(mediaAccess: MediaAccess): void {
  ipcMain.handle('shell:reveal', (_e, path: string) => {
    if (!mediaAccess.isAllowed(path)) return
    return shell.showItemInFolder(path)
  })
  ipcMain.handle('shell:open', (_e, path: string) => {
    if (!mediaAccess.isAllowed(path)) return 'Ruta no permitida'
    return shell.openPath(path)
  })
  // trashItem sends to the OS Trash / Recycle Bin (recoverable), never a hard delete.
  ipcMain.handle('shell:trash', async (_e, path: string) => {
    if (!mediaAccess.isAllowed(path)) throw new Error('Ruta no permitida')
    return shell.trashItem(path)
  })
  ipcMain.handle('clipboard:write', (_e, text: string) => clipboard.writeText(text))
  // The log path is resolved here (not sent by the renderer) so this can't be
  // used to reveal arbitrary files.
  ipcMain.handle('log:reveal', () => shell.showItemInFolder(log.transports.file.getFile().path))
}
