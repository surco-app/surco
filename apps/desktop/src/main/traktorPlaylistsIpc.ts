import { readFileSync } from 'node:fs'
import type { DjReadMain } from '../shared/djApi'
import {
  readTraktorCollection,
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

export function traktorRead(collection: () => string, host: TraktorPlaylistsHost): DjReadMain {
  const read = <T>(use: (nml: string) => T, fallback: T): T => {
    const file = collection()
    return file === '' ? fallback : use(readFileSync(file, 'utf8'))
  }
  return {
    available: () => collection() !== '',
    tree: () => read(readTraktorTree, []),
    recentCount: () => read((nml) => readTraktorRecentCount(nml), 0),
    trackCount: () => read(readTraktorTrackCount, 0),
    collection: () => read((nml) => readTraktorCollection(nml, host.bootVolume()), []),
    playlist: (id: string) => {
      const entries = read((nml) => readTraktorPlaylist(nml, id, host.bootVolume()), [])
      host.allowMedia?.(entries.flatMap((e) => (e.path ? [e.path] : [])))
      return entries
    },
    membership: (paths: string[]) =>
      read((nml) => readTraktorMembership(nml, paths, host.bootVolume()), {}),
  }
}
