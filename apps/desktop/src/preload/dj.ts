import type { IpcRenderer } from 'electron'
import type { DjApi, DjEvent } from '../shared/djApi'
import type { DjProgram } from '../shared/djProgram'

type DjIpc = Pick<IpcRenderer, 'invoke' | 'on' | 'removeListener'>

function subscribe<T>(ipc: DjIpc, channel: string, program: DjProgram, cb: (value: T) => void) {
  const listener = (_event: unknown, payload: DjEvent<T>): void => {
    if (payload.program === program) cb(payload.value)
  }
  ipc.on(channel, listener)
  return () => {
    ipc.removeListener(channel, listener)
  }
}

export function createDjApi(ipc: DjIpc): DjApi {
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
    cueQueue: (p) => ipc.invoke('dj:cueQueue', p),
    applyCueQueue: (p) => ipc.invoke('dj:applyCueQueue', p),
    discardCueQueue: (p) => ipc.invoke('dj:discardCueQueue', p),
    cueQueueReady: (p) => ipc.invoke('dj:cueQueueReady', p),
    onCueQueueChanged: (p, cb) => subscribe(ipc, 'dj:cueQueueChanged', p, cb),
    onCueQueueApplied: (p, cb) => subscribe(ipc, 'dj:cueQueueApplied', p, cb),
  }
}
