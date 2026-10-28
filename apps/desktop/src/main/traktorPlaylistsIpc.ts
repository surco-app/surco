import { readFileSync } from 'node:fs'
import { ipcMain } from 'electron'
import {
  readTraktorMembership,
  readTraktorPlaylist,
  readTraktorRecentCount,
  readTraktorTrackCount,
  readTraktorTree,
} from './traktorPlaylists'

export interface TraktorPlaylistsHost {
  bootVolume: () => string
  allowMedia?: (paths: string[]) => void
}

export function registerTraktorPlaylistsIpc(
  collection: () => string,
  host: TraktorPlaylistsHost,
): void {
  const read = <T>(use: (nml: string) => T, fallback: T): T => {
    const file = collection()
    return file === '' ? fallback : use(readFileSync(file, 'utf8'))
  }
  ipcMain.handle('traktor:available', () => collection() !== '')
  ipcMain.handle('traktor:tree', () => read(readTraktorTree, []))
  ipcMain.handle('traktor:recentCount', () => read((nml) => readTraktorRecentCount(nml), 0))
  ipcMain.handle('traktor:trackCount', () => read(readTraktorTrackCount, 0))
  ipcMain.handle('traktor:playlist', (_e, id: string) => {
    const entries = read((nml) => readTraktorPlaylist(nml, id, host.bootVolume()), [])
    host.allowMedia?.(entries.flatMap((e) => (e.path ? [e.path] : [])))
    return entries
  })
  ipcMain.handle('traktor:membership', (_e, paths: string[]) =>
    read((nml) => readTraktorMembership(nml, paths, host.bootVolume()), {}),
  )
}
