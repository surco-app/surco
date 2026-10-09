import { clipboard, ipcMain, shell } from 'electron'
import log from 'electron-log/main'
import { errorWithKey } from '../shared/errorKeys'
import type { MediaAccess } from './mediaAccess'
import { trashAsConfirmed } from './recoverableTrash'
import { volumeKeepsTrash } from './trashSupport'

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
    if (!mediaAccess.isAllowed(path)) return errorWithKey('pathNotAllowed').message
    return shell.openPath(path)
  })
  // To the OS Trash, or to Surco's backups on a disk with none. A hard delete only when
  // the dialog told the user so and they confirmed it (see trashAsConfirmed).
  ipcMain.handle('shell:trash', async (_e, path: string, permanentConfirmed?: unknown) => {
    if (!mediaAccess.isAllowed(path)) throw errorWithKey('pathNotAllowed')
    await trashAsConfirmed(path, { permanentConfirmed: permanentConfirmed === true })
  })
  // Whether a delete of this file can be described as recoverable. Asked of the
  // filesystem, not guessed from the path: /Volumes/Macintosh HD is the local disk while
  // /Volumes/Public is a NAS, and only the volume itself can tell them apart. Same
  // allowlist as the trash above, since it answers a question about a specific file.
  ipcMain.handle('shell:keepsTrash', (_e, path: string) => {
    if (!mediaAccess.isAllowed(path)) return false
    return volumeKeepsTrash(path)
  })
  ipcMain.handle('clipboard:write', (_e, text: string) => clipboard.writeText(text))
  // The log path is resolved here (not sent by the renderer) so this can't be
  // used to reveal arbitrary files.
  ipcMain.handle('log:reveal', () => shell.showItemInFolder(log.transports.file.getFile().path))
}
