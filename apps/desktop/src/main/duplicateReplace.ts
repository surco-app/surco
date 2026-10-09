import type {
  DuplicatePair,
  DuplicateReplaceOutcome,
  LibraryReplaceOutcome,
  ListMusicStep,
} from '../shared/types'
import type { Activity } from './activity'
import { toNmlLocation } from './ffmpeg'
import type { DuplicateReplaceResult } from './rekordboxDuplicates'
import type { NmlLocation } from './traktorNml'
import type { DuplicateCollectionResult } from './traktorNmlLibrary'
import { logKeptOpen, TRAKTOR_SYNC_SKIP_KEYS } from './traktorSyncFlush'

// After the review removes duplicate copies from Music, each DJ library with its sync on
// moves to the copy the user kept, and only then does a removed copy's file go to the
// Trash: never a file the kept copy shares, never one a library step left behind, never
// one a library still names. rekordbox and Engine DJ keep the removed copy's track (out of
// every playlist) when both copies were there, so that file always stays.

export type ReplacePair = DuplicatePair & { shared: boolean }

type Library = 'rekordbox' | 'engine' | 'traktor'
type LibraryStep = (pairs: DuplicatePair[]) => Promise<LibraryReplaceOutcome[]>

export interface ReplaceDuplicatesDeps {
  // Only the libraries whose sync is on.
  libraries: Partial<Record<Library, LibraryStep>>
  usedByLibrary: (path: string) => Promise<boolean>
  // Says where the file went: the system Trash, or Surco's own on a disk without one.
  trash: (path: string) => Promise<'trash' | 'surco'>
  serial: <T>(task: () => Promise<T>) => Promise<T>
  warn: (message: string, error: unknown) => void
  // The Activity row each removed copy opened, for its file's fate to join.
  log?: {
    track: Activity['track']
    copyOf: (path: string) => { group: string; label: string } | undefined
  }
  // The list review only: Apple Music lets go of the removed copy after the DJ libraries and
  // before the Trash, and a file Music still holds is not thrown away.
  musicStep?: (pair: ReplacePair) => Promise<MusicOutcome>
}

type MusicOutcome = { step: ListMusicStep; playlists?: number }

type FileFate = (
  | { fate: 'shared' | 'unsettled' | 'used' | 'music' | 'trash' | 'surco' }
  | { fate: 'failed'; error: string }
) & { music?: MusicOutcome }

const FATE: Record<FileFate['fate'], { detailKey: string; status?: 'warn' | 'error' }> = {
  shared: { detailKey: 'activity.reviewDuplicateFileShared' },
  unsettled: { detailKey: 'activity.reviewDuplicateFileUnsettled', status: 'warn' },
  used: { detailKey: 'activity.reviewDuplicateFileUsed' },
  music: { detailKey: 'activity.reviewDuplicateFileMusic', status: 'warn' },
  trash: { detailKey: 'activity.reviewDuplicateFileTrash' },
  surco: { detailKey: 'activity.reviewDuplicateFileSurco' },
  failed: { detailKey: 'activity.reviewDuplicateFileTrashFailed', status: 'error' },
}

const SETTLED: ReadonlySet<LibraryReplaceOutcome> = new Set(['repointed', 'replaced', 'none'])
const SKIPPED = new Set([
  'rekordbox-running',
  'engine-running',
  'traktor-running',
  'backup-failed',
  'unreadable',
  'read-only',
])

export function outcomeOf(result: DuplicateReplaceResult): LibraryReplaceOutcome {
  if (result.written) return result.outcome
  if (result.reason === 'no-match') return 'none'
  return SKIPPED.has(result.reason) ? 'skipped' : 'failed'
}

// The shared library flush (flushLibraryRepoints) owns the prompt to close the app and the
// Activity row; this keeps what the writer said about each pair. A flush that never ran the
// writer (the app left open, the user declining) leaves every pair skipped.
export async function libraryOutcomes(
  pairs: DuplicatePair[],
  flush: (
    run: (path: string, list: DuplicatePair[]) => Promise<DuplicateReplaceResult[]>,
  ) => Promise<unknown>,
  write: (path: string, list: DuplicatePair[]) => Promise<DuplicateReplaceResult[]>,
): Promise<LibraryReplaceOutcome[]> {
  let outcomes: LibraryReplaceOutcome[] = pairs.map(() => 'skipped')
  await flush(async (path, list) => {
    const results = await write(path, list)
    outcomes = results.map(outcomeOf)
    return results
  })
  return outcomes
}

export interface TraktorDuplicateDeps {
  nmlPath: string
  ensureTraktorClosed: () => Promise<boolean>
  showBlockedDialog: () => void
  track: Activity['track']
  replace: (
    nmlPath: string,
    pairs: { from: NmlLocation; to: NmlLocation }[],
  ) => Promise<DuplicateCollectionResult>
}

export async function traktorDuplicateStep(
  pairs: DuplicatePair[],
  deps: TraktorDuplicateDeps,
): Promise<LibraryReplaceOutcome[]> {
  if (!(await deps.ensureTraktorClosed())) {
    deps.showBlockedDialog()
    await logKeptOpen(deps.track)
    return pairs.map(() => 'skipped')
  }
  const result = await deps.track(
    'export',
    'activity.traktorSync',
    () =>
      deps.replace(
        deps.nmlPath,
        pairs.map((p) => ({ from: toNmlLocation(p.from), to: toNmlLocation(p.to) })),
      ),
    {
      summary: (r: DuplicateCollectionResult) => {
        if (r.written)
          return {
            detailKey: 'activity.duplicatesReplaced',
            detailParams: {
              count: r.outcomes.filter((o) => o === 'repointed' || o === 'replaced').length,
            },
          }
        return { detailKey: TRAKTOR_SYNC_SKIP_KEYS[r.reason ?? 'no-matches'] }
      },
    },
  )
  return result.outcomes
}

export function replaceDuplicates(
  pairs: ReplacePair[],
  deps: ReplaceDuplicatesDeps,
): Promise<DuplicateReplaceOutcome[]> {
  return deps.serial(async () => {
    const active = pairs.filter((p) => !p.shared)
    const byLibrary: Partial<Record<Library, LibraryReplaceOutcome[]>> = {}
    for (const library of ['traktor', 'rekordbox', 'engine'] as const) {
      const step = deps.libraries[library]
      if (!step || active.length === 0) continue
      try {
        byLibrary[library] = await step(active.map(({ from, to }) => ({ from, to })))
      } catch (error) {
        deps.warn(`library:replaceDuplicates ${library} failed`, error)
        byLibrary[library] = active.map(() => 'failed')
      }
    }
    const results: DuplicateReplaceOutcome[] = []
    for (const pair of pairs) {
      const result: DuplicateReplaceOutcome = {
        from: pair.from,
        fileTrashed: false,
        keptForLibrary: false,
      }
      results.push(result)
      const index = active.indexOf(pair)
      if (!pair.shared)
        for (const [library, outcomes] of Object.entries(byLibrary))
          result[library as Library] = outcomes[index]
      const decide = () => fileFate(pair, index, byLibrary, deps)
      const log = deps.log
      const copy = log?.copyOf(pair.from)
      const { fate, music } =
        log && copy
          ? await log.track('applemusic', 'activity.reviewDuplicateFile', decide, {
              group: copy.group,
              groupLabel: copy.label,
              summary: (f) => ({
                ...FATE[f.fate],
                ...(f.fate === 'failed' ? { detailParams: { error: f.error } } : {}),
              }),
            })
          : await decide()
      if (music !== undefined) result.music = music.step
      if (music?.playlists !== undefined) result.musicPlaylists = music.playlists
      result.keptForLibrary = fate === 'unsettled' || fate === 'used'
      if (fate === 'music') result.keptForMusic = true
      result.fileTrashed = fate === 'trash' || fate === 'surco'
      if (fate === 'failed') result.trashFailed = true
    }
    return results
  })
}

async function fileFate(
  pair: ReplacePair,
  index: number,
  byLibrary: Partial<Record<Library, LibraryReplaceOutcome[]>>,
  deps: ReplaceDuplicatesDeps,
): Promise<FileFate> {
  if (pair.shared) return { fate: 'shared' }
  const settled = Object.values(byLibrary).every((o) => SETTLED.has(o[index]))
  if (!settled) return { fate: 'unsettled' }
  const stillHeld =
    byLibrary.rekordbox?.[index] === 'replaced' || byLibrary.engine?.[index] === 'replaced'
  // Fails closed: a library that cannot be read may still use the file, and a trashed
  // file shows there as a missing track with its cues out of reach.
  if (stillHeld || (await deps.usedByLibrary(pair.from).catch(() => true))) return { fate: 'used' }
  let music: MusicOutcome | undefined
  if (deps.musicStep) {
    music = await deps.musicStep(pair).catch((error): MusicOutcome => {
      deps.warn('library:replaceDuplicates Music step failed', error)
      return { step: 'failed' }
    })
    if (music.step !== 'none' && music.step !== 'removed') return { fate: 'music', music }
  }
  try {
    return { fate: await deps.trash(pair.from), music }
  } catch (error) {
    deps.warn('library:replaceDuplicates trash failed', error)
    return { fate: 'failed', error: error instanceof Error ? error.message : String(error), music }
  }
}
