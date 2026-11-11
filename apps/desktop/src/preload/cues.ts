import type { IpcRenderer } from 'electron'
import type { CuesApi } from './api'

export function createCuesApi(ipc: Pick<IpcRenderer, 'invoke'>): CuesApi {
  return {
    trackCues: (contentId) => ipc.invoke('cues:trackCues', contentId),
    waveDetail: (contentId) => ipc.invoke('cues:waveDetail', contentId),
    waveFine: (contentId) => ipc.invoke('cues:waveFine', contentId),
    dropInput: (contentId) => ipc.invoke('cues:dropInput', contentId),
    twins: (file) => ipc.invoke('cues:twins', file),
    auditionLead: (contentId) => ipc.invoke('cues:auditionLead', contentId),
    surcoGrid: (contentId) => ipc.invoke('cues:surcoGrid', contentId),
    gridFit: (contentId, priority = 'high') => ipc.invoke('cues:gridFit', contentId, priority),
    queued: (contentId) => ipc.invoke('cues:queued', contentId),
    undo: (contentId) => ipc.invoke('cues:undo', contentId),
    save: (reqs) => ipc.invoke('cues:save', reqs),
  }
}
