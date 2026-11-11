import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { DjReadMain } from '../shared/djApi'
import { PROGRAM_CAN } from '../shared/djProgram'
import {
  readVirtualdjLibrary,
  virtualdjCollection,
  virtualdjMembership,
  virtualdjPlaylist,
  virtualdjRecentCount,
  virtualdjTrackCount,
  virtualdjTree,
} from './virtualdjLibrary'

export interface VirtualdjPlaylistsHost {
  dir: () => string
  allowMedia?: (paths: string[]) => void
}

export function virtualdjRead(host: VirtualdjPlaylistsHost): DjReadMain {
  const library = () => readVirtualdjLibrary(host.dir())
  return {
    available: () =>
      (process.platform !== 'win32' || PROGRAM_CAN.virtualdj.windows) &&
      existsSync(join(host.dir(), 'database.xml')),
    tree: () => virtualdjTree(library()),
    recentCount: () => virtualdjRecentCount(library()),
    trackCount: () => virtualdjTrackCount(library()),
    collection: () => virtualdjCollection(library()),
    playlist: (id: string) => {
      const entries = virtualdjPlaylist(library(), id)
      host.allowMedia?.(entries.flatMap((e) => (e.path ? [e.path] : [])))
      return entries
    },
    membership: (paths: string[]) => virtualdjMembership(library(), paths),
  }
}
