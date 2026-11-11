import type { DjReadMain } from '../shared/djApi'
import {
  readSeratoLibrary,
  type SeratoLibraryRoot,
  seratoCollection,
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

export function seratoRead(host: SeratoPlaylistsHost): DjReadMain {
  const library = () => readSeratoLibrary(host.roots())
  return {
    available: () => host.roots().length > 0,
    tree: () => seratoTree(library()),
    recentCount: () => seratoRecentCount(library()),
    trackCount: () => seratoTrackCount(library()),
    collection: () => seratoCollection(library()),
    playlist: (id: string) => {
      const entries = seratoPlaylist(library(), id)
      host.allowMedia?.(entries.flatMap((e) => (e.path ? [e.path] : [])))
      return entries
    },
    membership: (paths: string[]) => seratoMembership(library(), paths),
  }
}
