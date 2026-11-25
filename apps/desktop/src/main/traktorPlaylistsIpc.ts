import type { DjReadMain } from '../shared/djApi'
import type { TraktorReadAnswer, TraktorReadArg, TraktorReadName } from './traktorReads'
import { readTraktor } from './worker'

export interface TraktorPlaylistsHost {
  bootVolume: () => string
  allowMedia?: (paths: string[]) => void
}

export function traktorRead(collection: () => string, host: TraktorPlaylistsHost): DjReadMain {
  const read = <N extends TraktorReadName>(
    name: N,
    arg: TraktorReadArg<N>,
  ): Promise<TraktorReadAnswer<N>> => readTraktor(collection(), host.bootVolume(), name, arg)
  return {
    available: () => collection() !== '',
    tree: () => read('tree', undefined),
    recentCount: () => read('recentCount', undefined),
    trackCount: () => read('trackCount', undefined),
    // Update retags the copy the editor found in this collection, and main writes only
    // files it granted.
    collection: async () => {
      const rows = await read('collection', undefined)
      host.allowMedia?.(rows.flatMap((r) => (r.path ? [r.path] : [])))
      return rows
    },
    playlist: async (id: string) => {
      const entries = await read('playlist', id)
      host.allowMedia?.(entries.flatMap((e) => (e.path ? [e.path] : [])))
      return entries
    },
    membership: (paths: string[]) => read('membership', paths),
    playedTogether: (ids: string[]) => read('playedTogether', ids),
  }
}
