import { ipcMain, type WebContents } from 'electron'
import type { ListFixRequest, ListMusicOutcome, ListRemoval } from '../shared/types'
import type { Activity } from './activity'
import { type ReplaceDuplicatesDeps, type ReplacePair, replaceDuplicates } from './duplicateReplace'
import { applyListFixes, type ListApplyDeps } from './listReviewApply'
import { type ListMusicDeps, removeListCopyFromMusic } from './musicDuplicates'
import type { MusicReviewLog } from './musicReviewLog'

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
  log?: { track: Activity['track']; reviewLog: MusicReviewLog }
}

// The list review's writes. Not limited to macOS: the list exists everywhere, and only the
// Music half of each step is left out where there is no Music.
export function registerListReviewIpc(deps: ListReviewIpcDeps): void {
  const running = new Set<{ cancelled: boolean }>()
  ipcMain.handle('listreview:applyFixes', async (e, req: ListFixRequest) => {
    const run = { cancelled: false }
    running.add(run)
    const titleOf = (path: string) => req.titles[path] ?? path
    const log = deps.log && {
      track: deps.log.track,
      group: deps.log.reviewLog.beginListRun(),
      titleOf,
    }
    try {
      const outcomes = await applyListFixes(req, deps.apply, {
        isCancelled: () => run.cancelled,
        onProgress: (progress) => {
          if (!e.sender.isDestroyed()) e.sender.send('listreview:fixProgress', progress)
        },
        ...(log && { log }),
      })
      if (log) deps.log?.reviewLog.rememberListRun(log.group, outcomes, titleOf)
      return outcomes
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
    const log = deps.log
    if (log)
      for (const r of removals)
        log.reviewLog.rememberCopy(r.from, { group: `list-duplicate-${r.from}`, label: r.label })
    const outcomes = await replaceDuplicates(pairs, {
      ...d.replace,
      trash: d.trash,
      ...(log && { log: { track: log.track, copyOf: log.reviewLog.copyOf } }),
      ...(musicDeps && {
        musicStep: (pair: ReplacePair) => {
          const step = () =>
            removeListCopyFromMusic(
              { ...pair, music: byPair.get(pair)?.music },
              { ...musicDeps, heldElsewhere },
            )
          const copy = log?.reviewLog.copyOf(pair.from)
          return log && copy
            ? log.track('applemusic', 'activity.reviewDuplicateMusic', step, {
                group: copy.group,
                groupLabel: copy.label,
                summary: musicEnding,
              })
            : step()
        },
      }),
    })
    return outcomes.map((o, i) => (pairs[i].shared ? { ...o, keptShared: true as const } : o))
  })
}

const MUSIC_ENDING: Record<
  Exclude<ListMusicOutcome['step'], 'removed'>,
  { detailKey: string; status?: 'warn' | 'error' }
> = {
  none: { detailKey: 'activity.listReviewDuplicateNotInMusic' },
  held: { detailKey: 'activity.listReviewDuplicateHeld', status: 'warn' },
  'kept-no-entry': { detailKey: 'activity.listReviewDuplicateKeptNoEntry', status: 'warn' },
  ambiguous: { detailKey: 'activity.listReviewDuplicateAmbiguous', status: 'warn' },
  mismatch: { detailKey: 'activity.reviewDuplicateMismatch', status: 'warn' },
  failed: { detailKey: 'activity.reviewDuplicateFailed', status: 'error' },
}

// What Music did with one removed list copy.
function musicEnding(music: ListMusicOutcome) {
  const count = { count: music.playlists ?? 0 }
  if (music.entryRemoved)
    return {
      detailKey: 'activity.listReviewDuplicateRemovedHeld',
      detailParams: count,
      status: 'warn' as const,
    }
  if (music.step === 'removed')
    return { detailKey: 'activity.reviewDuplicateRemoved', detailParams: count }
  return MUSIC_ENDING[music.step]
}

// Wider than the file system's own rule on purpose: a false match only keeps a file.
const heldKey = (path: string) => path.normalize('NFC').toLowerCase()
