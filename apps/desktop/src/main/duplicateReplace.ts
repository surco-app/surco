import type { DuplicatePair, DuplicateReplaceOutcome, LibraryReplaceOutcome } from '../shared/types'
import type { Activity } from './activity'
import { toNmlLocation } from './ffmpeg'
import type { DuplicateReplaceResult } from './rekordboxDuplicates'
import type { NmlLocation } from './traktorNml'
import type { DuplicateCollectionResult } from './traktorNmlLibrary'
import { TRAKTOR_SYNC_SKIP_KEYS } from './traktorSyncFlush'

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
  trash: (path: string) => Promise<void>
  serial: <T>(task: () => Promise<T>) => Promise<T>
  warn: (message: string, error: unknown) => void
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
      if (pair.shared) continue
      const index = active.indexOf(pair)
      for (const [library, outcomes] of Object.entries(byLibrary))
        result[library as Library] = outcomes[index]
      const settled = Object.values(byLibrary).every((o) => SETTLED.has(o[index]))
      const stillHeld =
        byLibrary.rekordbox?.[index] === 'replaced' || byLibrary.engine?.[index] === 'replaced'
      // Fails closed: a library that cannot be read may still use the file, and a trashed
      // file shows there as a missing track with its cues out of reach.
      if (!settled || stillHeld || (await deps.usedByLibrary(pair.from).catch(() => true))) {
        result.keptForLibrary = true
        continue
      }
      try {
        await deps.trash(pair.from)
        result.fileTrashed = true
      } catch (error) {
        deps.warn('library:replaceDuplicates trash failed', error)
      }
    }
    return results
  })
}
