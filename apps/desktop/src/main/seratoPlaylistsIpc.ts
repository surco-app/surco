import { ipcMain } from 'electron'
import {
  readSeratoLibrary,
  type SeratoLibraryRoot,
  seratoMembership,
  seratoPlaylist,
  seratoRecentCount,
  seratoTrackCount,
  seratoTree,
} from './seratoLibrary'

export interface SeratoPlaylistsHost {
  roots: () => SeratoLibraryRoot[]
  allowMedia?: (paths: string[]) => void
}

export function registerSeratoPlaylistsIpc(host: SeratoPlaylistsHost): void {
  const library = () => readSeratoLibrary(host.roots())
  ipcMain.handle('serato:available', () => host.roots().length > 0)
  ipcMain.handle('serato:tree', () => seratoTree(library()))
  ipcMain.handle('serato:recentCount', () => seratoRecentCount(library()))
  ipcMain.handle('serato:trackCount', () => seratoTrackCount(library()))
  ipcMain.handle('serato:playlist', (_e, id: string) => {
    const entries = seratoPlaylist(library(), id)
    host.allowMedia?.(entries.flatMap((e) => (e.path ? [e.path] : [])))
    return entries
  })
  ipcMain.handle('serato:membership', (_e, paths: string[]) => seratoMembership(library(), paths))
}
