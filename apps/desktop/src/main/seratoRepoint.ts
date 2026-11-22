import { join } from 'node:path'
import type { LibraryRepointResult } from './libraryRepointFlush'
import type { RekordboxRepoint } from './rekordboxBatch'
import type { QueueApply, RekordboxQueue } from './rekordboxQueue'
import {
  crateTrackPaths,
  seratoPathOn,
  seratoRootOf,
  withCrateTrackRepointed,
} from './seratoCrateFile'
import { seratoDatabaseTruncated } from './seratoDatabase'
import { withSeratoTrackRepointed } from './seratoDatabaseWrite'
import {
  commitSeratoDraft,
  createSeratoDraft,
  type SeratoCommitDeps,
  type SeratoDraft,
} from './seratoLibraryWrite'

// Points Serato's database and crates at the file that replaced a track, so its BPM, key,
// plays and crate positions follow the track instead of staying on a file that is about to go.
// It goes through the same draft and commit as every other Serato write (backup, stamps,
// rollback, Serato-closed guard), in one commit for the whole run.

const DATABASE = 'database V2'

type Outcome = LibraryRepointResult | 'truncated'

// Each volume keeps its own _Serato_ library, and an entry stores a path relative to its
// volume, so a file that moved to another drive cannot be followed by pointing the old entry.
function repointOne(
  draft: SeratoDraft,
  repoint: RekordboxRepoint,
  deps: SeratoCommitDeps,
): Outcome {
  const roots = deps.roots()
  const root = seratoRootOf(repoint.from, roots)
  const target = seratoRootOf(repoint.to, roots)
  if (!root || !target || target.dir !== root.dir) return { written: false, reason: 'other-volume' }

  const databaseFile = join(root.dir, DATABASE)
  const database = draft.read(databaseFile)
  if (!database) return { written: false, reason: 'no-match' }
  if (seratoDatabaseTruncated(database)) return 'truncated'
  const from = seratoPathOn(repoint.from, root)
  const to = seratoPathOn(repoint.to, root)
  const repointed = withSeratoTrackRepointed(database, from, to)
  if (!repointed) return { written: false, reason: 'no-match' }
  draft.write(databaseFile, repointed)

  const subcrates = join(root.dir, 'Subcrates')
  for (const name of draft.list(subcrates).filter((n) => n.endsWith('.crate'))) {
    const file = join(subcrates, name)
    const bytes = draft.read(file)
    if (!bytes || crateTrackPaths(bytes) === null) return 'truncated'
    const crate = withCrateTrackRepointed(bytes, from, to)
    if (crate) draft.write(file, crate)
  }
  return { written: true }
}

export async function repointSerato(
  repoints: RekordboxRepoint[],
  deps: SeratoCommitDeps,
): Promise<LibraryRepointResult[]> {
  const all = (reason: string): LibraryRepointResult[] =>
    repoints.map(() => ({ written: false, reason }))
  const draft = createSeratoDraft()
  const outcomes = repoints.map((r) => repointOne(draft, r, deps))
  if (outcomes.includes('truncated')) return all('unreadable')
  const results = outcomes as LibraryRepointResult[]
  switch (await commitSeratoDraft(draft, deps)) {
    case 'written':
    case 'nothing':
      return results
    case 'cancelled':
      return results.map((r) => (r.written ? { written: false, reason: 'rekordbox-running' } : r))
    case 'backup-failed':
      return all('backup-failed')
    default:
      return all('write-failed')
  }
}

// How long retiring a replaced original waits for Serato's queue before giving up and keeping it.
const SETTLE_TIMEOUT_MS = 15_000

// The retire flow asks whether any library still uses a replaced original, and it asks once.
// Serato's repoint waits in its queue until someone applies it, so without this the question
// could come before database V2 changed and the old file would be kept for good. Applying the
// pending repoint first lets a closed Serato release the file; an open Serato refuses the
// write, the repoint stays queued, and the original stays too. A failing or slow apply must
// not block or break the retire, so it is abandoned and the original is simply kept.
export async function settleSeratoRepoint(
  path: string,
  deps: {
    queue: Pick<RekordboxQueue, 'holdsRepoint' | 'apply'>
    isRunning: () => Promise<boolean>
    onApplied: (result: QueueApply) => void
  },
): Promise<void> {
  if (!deps.queue.holdsRepoint(path)) return
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const gaveUp = new Promise<undefined>((resolve) => {
      timer = setTimeout(() => resolve(undefined), SETTLE_TIMEOUT_MS)
    })
    const applying = deps.queue.apply(async () => !(await deps.isRunning()))
    const result = await Promise.race([applying, gaveUp])
    if (result) deps.onApplied(result)
  } catch {
    // the original is kept
  } finally {
    clearTimeout(timer)
  }
}
