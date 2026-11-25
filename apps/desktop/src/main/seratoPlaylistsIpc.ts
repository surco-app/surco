import type { DjReadMain } from '../shared/djApi'
import type { SeratoLibraryRoot } from './seratoLibrary'
import { readSerato } from './worker'

export interface SeratoPlaylistsHost {
  roots: () => SeratoLibraryRoot[]
  allowMedia?: (paths: string[]) => void
}

export function seratoRead(host: SeratoPlaylistsHost): DjReadMain {
  return {
    available: () => host.roots().length > 0,
    tree: () => readSerato(host.roots(), 'tree', undefined),
    recentCount: () => readSerato(host.roots(), 'recentCount', undefined),
    trackCount: () => readSerato(host.roots(), 'trackCount', undefined),
    // Update retags the copy the editor found in this collection, and main writes only
    // files it granted.
    collection: async () => {
      const rows = await readSerato(host.roots(), 'collection', undefined)
      host.allowMedia?.(rows.flatMap((r) => (r.path ? [r.path] : [])))
      return rows
    },
    playlist: async (id: string) => {
      const entries = await readSerato(host.roots(), 'playlist', id)
      host.allowMedia?.(entries.flatMap((e) => (e.path ? [e.path] : [])))
      return entries
    },
    membership: (paths: string[]) => readSerato(host.roots(), 'membership', paths),
  }
}
