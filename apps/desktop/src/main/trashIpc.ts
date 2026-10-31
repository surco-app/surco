import { mkdir } from 'node:fs/promises'
import { ipcMain, shell } from 'electron'
import log from 'electron-log/main'
import { activity } from './activity'
import type { MediaAccess } from './mediaAccess'
import type { Rewritten } from './musicFieldWrite'
import { musicReviewLog, restoreLogged } from './musicReviewLog'
import type { SurcoTrash } from './surcoTrash'

// The renderer's window onto Surco's trash (see surcoTrash.ts): list, restore, remove,
// empty, and reveal the folder in Finder. Ids come from the renderer but only ever name
// entries the manifest holds, so nothing here reaches a path the app did not stash.
export function registerTrashIpc(
  trash: SurcoTrash,
  mediaAccess: MediaAccess,
  deps: { followEngineSize?: Rewritten } = {},
): void {
  ipcMain.handle('trash:list', () => trash.list())
  ipcMain.handle('trash:restore', async (_e, id: string, from?: 'undo') => {
    const result = await restoreLogged(
      id,
      () => trash.restore(id),
      { track: activity.track, log: musicReviewLog },
      from === 'undo' ? 'undo' : 'panel',
    )
    // The row that pointed at this file can stream it again straight away.
    mediaAccess.allow(result.restoredTo)
    // A move written for another file than the one set aside (a later cut, a retag between)
    // would land half right: the row is left as it is, for the next check to call stale.
    const displaced = result.displaced
    if (displaced && !result.engine) deps.followEngineSize?.(result.restoredTo, displaced.bytes)
    else if (displaced && result.engine?.over === displaced.bytes)
      deps.followEngineSize?.(result.restoredTo, displaced.bytes, result.engine.shift)
    else if (displaced)
      log.warn(
        `restore of ${result.restoredTo} left Engine DJ's row: the file set aside is not the one its move was for`,
      )
    return result
  })
  ipcMain.handle('trash:remove', (_e, id: string) => trash.remove(id))
  ipcMain.handle('trash:empty', () => trash.empty())
  ipcMain.handle('trash:reveal', async () => {
    await mkdir(trash.dir, { recursive: true })
    shell.showItemInFolder(trash.dir)
  })
}
