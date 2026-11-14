import type { IpcRenderer } from 'electron'
import {
  DJ_CUE_QUEUE_APPLIED,
  DJ_CUE_QUEUE_CHANGED,
  DJ_SYNC_ISSUE,
  type DjApi,
  type DjEvent,
} from '../shared/djApi'
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
    matching: (p) => ipc.invoke('dj:matching', p),
    editPlaylist: (p, ...args) => ipc.invoke('dj:editPlaylist', p, ...args),
    hasSeparator: (p) => ipc.invoke('dj:hasSeparator', p),
    match: (p, ...args) => ipc.invoke('dj:match', p, ...args),
    cueQueue: (p) => ipc.invoke('dj:cueQueue', p),
    applyCueQueue: (p) => ipc.invoke('dj:applyCueQueue', p),
    discardCueQueue: (p) => ipc.invoke('dj:discardCueQueue', p),
    cueQueueReady: (p) => ipc.invoke('dj:cueQueueReady', p),
    onCueQueueChanged: (p, cb) => subscribe(ipc, DJ_CUE_QUEUE_CHANGED, p, cb),
    onCueQueueApplied: (p, cb) => subscribe(ipc, DJ_CUE_QUEUE_APPLIED, p, cb),
    exportCollection: (p, payload) => ipc.invoke('dj:exportCollection', p, payload),
    pickLibraryPath: (p) => ipc.invoke('dj:pickLibraryPath', p),
    running: (p) => ipc.invoke('dj:running', p),
    askToApply: (programs) => ipc.invoke('dj:ask-to-apply', programs),
    onSyncIssue: (p, cb) => subscribe(ipc, DJ_SYNC_ISSUE, p, cb),
  }
}
