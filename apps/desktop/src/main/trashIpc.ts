import { mkdir } from 'node:fs/promises'
import { ipcMain, shell } from 'electron'
import type { MediaAccess } from './mediaAccess'
import type { SurcoTrash } from './surcoTrash'

// The renderer's window onto Surco's trash (see surcoTrash.ts): list, restore, remove,
// empty, and reveal the folder in Finder. Ids come from the renderer but only ever name
// entries the manifest holds, so nothing here reaches a path the app did not stash.
export function registerTrashIpc(trash: SurcoTrash, mediaAccess: MediaAccess): void {
  ipcMain.handle('trash:list', () => trash.list())
  ipcMain.handle('trash:restore', async (_e, id: string) => {
    const result = await trash.restore(id)
    // The row that pointed at this file can stream it again straight away.
    mediaAccess.allow(result.restoredTo)
    return result
  })
  ipcMain.handle('trash:remove', (_e, id: string) => trash.remove(id))
  ipcMain.handle('trash:empty', () => trash.empty())
  ipcMain.handle('trash:reveal', async () => {
    await mkdir(trash.dir, { recursive: true })
    shell.showItemInFolder(trash.dir)
  })
}
