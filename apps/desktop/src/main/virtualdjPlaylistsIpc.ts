import type { DjReadMain } from '../shared/djApi'
import { PROGRAM_CAN } from '../shared/djProgram'
import { isVirtualdjHome, type VirtualdjRoot } from './virtualdjLibrary'
import { readVirtualdj } from './worker'

export interface VirtualdjPlaylistsHost {
  roots: () => VirtualdjRoot[]
  allowMedia?: (paths: string[]) => void
}

export function virtualdjRead(host: VirtualdjPlaylistsHost): DjReadMain {
  return {
    available: () =>
      (process.platform !== 'win32' || PROGRAM_CAN.virtualdj.windows) &&
      host.roots().some(isVirtualdjHome),
    tree: () => readVirtualdj(host.roots(), 'tree', undefined),
    recentCount: () => readVirtualdj(host.roots(), 'recentCount', undefined),
    trackCount: () => readVirtualdj(host.roots(), 'trackCount', undefined),
    collection: () => readVirtualdj(host.roots(), 'collection', undefined),
    playlist: async (id: string) => {
      const entries = await readVirtualdj(host.roots(), 'playlist', id)
      host.allowMedia?.(entries.flatMap((e) => (e.path ? [e.path] : [])))
      return entries
    },
    membership: (paths: string[]) => readVirtualdj(host.roots(), 'membership', paths),
  }
}
