import { ipcMain, type WebContents } from 'electron'
import type { ListFixRequest, ListRemoval } from '../shared/types'
import { type ReplaceDuplicatesDeps, type ReplacePair, replaceDuplicates } from './duplicateReplace'
import { applyListFixes, type ListApplyDeps } from './listReviewApply'
import { type ListMusicDeps, removeListCopyFromMusic } from './musicDuplicates'

export interface ListRemovalDeps {
  replace: Omit<ReplaceDuplicatesDeps, 'trash' | 'musicStep' | 'log'>
  realpath: (path: string) => Promise<string | null>
  trash: (path: string) => Promise<'trash' | 'surco'>
  // Undefined off macOS.
  music?: Omit<ListMusicDeps, 'heldElsewhere'> & {
    fileLocations: () => Promise<{ persistentId: string; path: string }[]>
  }
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

  // Paths come from the renderer. A file is left alone when the app never handed it over,
  // when it cannot be resolved, or when any pair in the batch may keep its audio: its real
  // path is some pair's kept copy, or it is named for removal twice.
  ipcMain.handle('listreview:removeDuplicates', async (e, removals: ListRemoval[]) => {
    if (removals.length === 0) return []
    const d = deps.removal(e.sender)
    const paths = [...new Set(removals.flatMap((r) => [r.from, r.to]))]
    const real = new Map(
      await Promise.all(
        paths.map(
          async (p) => [p, p ? ((await d.realpath(p))?.normalize('NFC') ?? null) : null] as const,
        ),
      ),
    )
    const kept = new Set(removals.map((r) => real.get(r.to)))
    const removedTimes = new Map<string | null | undefined, number>()
    for (const r of removals) {
      const key = real.get(r.from)
      removedTimes.set(key, (removedTimes.get(key) ?? 0) + 1)
    }
    const byPair = new Map<ReplacePair, ListRemoval>()
    const pairs = removals.map((removal) => {
      const { from, to } = removal
      const realFrom = real.get(from)
      const pair = {
        from,
        to,
        shared:
          !deps.isAllowed(from) ||
          !deps.isAllowed(to) ||
          !realFrom ||
          !real.get(to) ||
          kept.has(realFrom) ||
          (removedTimes.get(realFrom) ?? 0) > 1,
      }
      byPair.set(pair, removal)
      return pair
    })
    const musicDeps = d.music
    let held: Promise<Map<string, string[]>> | undefined
    const heldElsewhere = async (path: string, except: string[]) => {
      held ??= (async () => {
        if (!e.sender.isDestroyed()) e.sender.send('listreview:removalPhase', 'checking-music')
        const byPath = new Map<string, string[]>()
        for (const { persistentId, path: at } of (await musicDeps?.fileLocations()) ?? [])
          byPath.set(heldKey(at), [...(byPath.get(heldKey(at)) ?? []), persistentId])
        return byPath
      })()
      const byPath = await held
      const realPath = real.get(path)
      return [path, ...(realPath ? [realPath] : [])]
        .flatMap((p) => byPath.get(heldKey(p)) ?? [])
        .some((pid) => !except.includes(pid))
    }
    const outcomes = await replaceDuplicates(pairs, {
      ...d.replace,
      trash: d.trash,
      ...(musicDeps && {
        musicStep: (pair: ReplacePair) =>
          removeListCopyFromMusic(
            { ...pair, music: byPair.get(pair)?.music },
            { ...musicDeps, heldElsewhere },
          ),
      }),
    })
    return outcomes.map((o, i) => (pairs[i].shared ? { ...o, keptShared: true as const } : o))
  })
}

// Wider than the file system's own rule on purpose: a false match only keeps a file.
const heldKey = (path: string) => path.normalize('NFC').toLowerCase()
