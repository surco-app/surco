import { ipcMain, type WebContents } from 'electron'
import type { ListFixRequest, ListRemoval } from '../shared/types'
import { type ReplaceDuplicatesDeps, type ReplacePair, replaceDuplicates } from './duplicateReplace'
import { applyListFixes, type ListApplyDeps } from './listReviewApply'
import { type ListMusicDeps, mayShareFile, removeListCopyFromMusic } from './musicDuplicates'

export interface ListRemovalDeps {
  replace: Omit<ReplaceDuplicatesDeps, 'trash' | 'musicStep'>
  realpath: (path: string) => Promise<string | null>
  trash: (path: string) => Promise<void>
  // Undefined off macOS.
  music?: ListMusicDeps
}

export interface ListReviewIpcDeps {
  apply: ListApplyDeps
  isAllowed: (path: string) => boolean
  removal: (sender: WebContents) => ListRemovalDeps
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

  // Paths come from the renderer: one it was never handed, or a pair that may be one file,
  // is passed on as shared, which replaceDuplicates never touches.
  ipcMain.handle('listreview:removeDuplicates', async (e, removals: ListRemoval[]) => {
    if (removals.length === 0) return []
    const d = deps.removal(e.sender)
    const pairs = await Promise.all(
      removals.map(async ({ from, to }) => ({
        from,
        to,
        shared: !deps.isAllowed(from) || !deps.isAllowed(to) || (await mayShareFile(from, to, d)),
      })),
    )
    const byFrom = new Map(removals.map((r) => [r.from, r]))
    const musicDeps = d.music
    return replaceDuplicates(pairs, {
      ...d.replace,
      trash: d.trash,
      ...(musicDeps && {
        musicStep: (pair: ReplacePair) =>
          removeListCopyFromMusic({ ...pair, music: byFrom.get(pair.from)?.music }, musicDeps),
      }),
    })
  })
}
