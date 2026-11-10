import type { IpcRenderer } from 'electron'
import type { DjApi } from '../shared/djApi'

export function createDjApi(ipc: Pick<IpcRenderer, 'invoke' | 'on' | 'removeListener'>): DjApi {
  return {
    available: (p) => ipc.invoke('dj:available', p),
    tree: (p) => ipc.invoke('dj:tree', p),
    recentCount: (p) => ipc.invoke('dj:recentCount', p),
    trackCount: (p) => ipc.invoke('dj:trackCount', p),
    playlist: (p, id) => ipc.invoke('dj:playlist', p, id),
    membership: (p, paths) => ipc.invoke('dj:membership', p, paths),
    collection: (p) => ipc.invoke('dj:collection', p),
    editPlaylist: (p, edit, label) => ipc.invoke('dj:editPlaylist', p, edit, label),
    hasSeparator: (p) => ipc.invoke('dj:hasSeparator', p),
  }
}
