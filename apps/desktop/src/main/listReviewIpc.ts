import { ipcMain } from 'electron'
import type { ListFixRequest } from '../shared/types'
import { applyListFixes, type ListApplyDeps } from './listReviewApply'

export interface ListReviewIpcDeps {
  apply: ListApplyDeps
}

// The list review's writes. Not limited to macOS: the list exists everywhere, and only the
// Music half of each step is left out where there is no Music.
export function registerListReviewIpc(deps: ListReviewIpcDeps): void {
  const running = new Set<{ cancelled: boolean }>()
  ipcMain.handle('listreview:applyFixes', async (e, req: ListFixRequest) => {
    const run = { cancelled: false }
    running.add(run)
    try {
      return await applyListFixes(req, deps.apply, {
        isCancelled: () => run.cancelled,
        onProgress: (progress) => {
          if (!e.sender.isDestroyed()) e.sender.send('listreview:fixProgress', progress)
        },
      })
    } finally {
      running.delete(run)
    }
  })
  ipcMain.handle('listreview:cancelFixes', () => {
    for (const run of running) run.cancelled = true
  })
}
