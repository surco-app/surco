import { ipcMain, type WebContents } from 'electron'
import type { ListFixRequest, ListMusicOutcome, ListRemoval } from '../shared/types'
import type { Activity } from './activity'
import { type ReplaceDuplicatesDeps, type ReplacePair, replaceDuplicates } from './duplicateReplace'
import { applyListFixes, type ListApplyDeps } from './listReviewApply'
import { type ListMusicDeps, removeListCopyFromMusic } from './musicDuplicates'
import type { MusicReviewLog } from './musicReviewLog'

// Big integers: an NTFS or SMB file id does not fit a float exactly.
export interface FileIdentity {
  dev: bigint
  ino: bigint
  size: bigint
  mtimeNs: bigint
  // On a volume with no Trash of its own (a network share), where two mounts of one share
  // give one file two devices.
  remote: boolean
}

export interface ListRemovalDeps {
  replace: Omit<ReplaceDuplicatesDeps, 'trash' | 'musicStep' | 'log'>
  realpath: (path: string) => Promise<string | null>
  identity?: (path: string) => Promise<FileIdentity | null>
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
  let removalRuns = 0
  ipcMain.handle('listreview:applyFixes', async (e, req: ListFixRequest) => {
    const run = { cancelled: false }
    running.add(run)
    const titleOf = (path: string) => req.titles[path] ?? path
    const log = deps.log && {
      track: deps.log.track,
      group: deps.log.reviewLog.beginListRun(),
      titleOf,
      kind: 'review' as const,
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
    const ids = new Map(
      await Promise.all(
        paths.map(async (p) => [p, (await d.identity?.(p).catch(() => null)) ?? null] as const),
      ),
    )
    const keptIds = removals.flatMap((r) => ids.get(r.to) ?? [])
    const sharesKeptAudio = (path: string) => {
      const a = ids.get(path)
      return !!a && keptIds.some((b) => sameAudio(a, b))
    }
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
          sharesKeptAudio(from) ||
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
    // Keyed by the run too: a second try at the same copy gets its own row.
    const removalRun = ++removalRuns
    if (log)
      for (const r of removals)
        log.reviewLog.rememberCopy(r.from, {
          group: `list-duplicate-${removalRun}-${r.from}`,
          label: r.label,
        })
    const outcomes = await replaceDuplicates(pairs, {
      ...d.replace,
      trash: d.trash,
      ...(log && { log: { track: log.track, copyOf: log.reviewLog.copyOf, kind: 'review' } }),
      ...(musicDeps && {
        musicStep: (pair: ReplacePair) => {
          const step = () =>
            removeListCopyFromMusic(
              { ...pair, music: byPair.get(pair)?.music },
              { ...musicDeps, heldElsewhere },
            )
          const copy = log?.reviewLog.copyOf(pair.from)
          return log && copy
            ? log.track('review', 'activity.reviewDuplicateMusic', step, {
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
  unchecked: { detailKey: 'activity.listReviewDuplicateUnchecked', status: 'warn' },
  mismatch: { detailKey: 'activity.reviewDuplicateMismatch', status: 'warn' },
  failed: { detailKey: 'activity.reviewDuplicateFailed', status: 'error' },
}

// Steps that never tried to take an entry out of Music: their row says Music was checked.
const ONLY_CHECKED = new Set<ListMusicOutcome['step']>([
  'none',
  'held',
  'kept-no-entry',
  'ambiguous',
  'unchecked',
])

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
  return {
    ...MUSIC_ENDING[music.step],
    ...(ONLY_CHECKED.has(music.step) && { labelKey: 'activity.reviewDuplicateMusicChecked' }),
  }
}

// realpath cannot see a hard link or a share mounted twice. Two mounts of one share give
// the file two devices but the server's inode; a Finder or Explorer copy keeps the size and
// the date and gets a new inode, so the inode always has to match.
function sameAudio(a: FileIdentity, b: FileIdentity): boolean {
  if (a.ino !== b.ino) return false
  if (a.dev === b.dev) return true
  return a.remote && b.remote && a.size === b.size && a.mtimeNs === b.mtimeNs
}

// Wider than the file system's own rule on purpose: a false match only keeps a file.
const heldKey = (path: string) => path.normalize('NFC').toLowerCase()
