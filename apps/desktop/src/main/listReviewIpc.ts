import { ipcMain } from 'electron'
import type { ListFixRequest } from '../shared/types'
import { applyListFixes, type ListApplyDeps } from './listReviewApply'

export interface ListReviewIpcDeps {
  apply: ListApplyDeps
}

// The list review's writes. Not limited to macOS: the list exists everywhere, and only the
// Music half of each step is left out where there is no Music.
export function registerListReviewIpc(deps: ListReviewIpcDeps): void {
  let cancelled = false
  ipcMain.handle('listreview:applyFixes', (e, req: ListFixRequest) => {
    cancelled = false
    return applyListFixes(req, deps.apply, {
      isCancelled: () => cancelled,
      onProgress: (progress) => {
        if (!e.sender.isDestroyed()) e.sender.send('listreview:fixProgress', progress)
      },
    })
  })
  ipcMain.handle('listreview:cancelFixes', () => {
    cancelled = true
  })
}
