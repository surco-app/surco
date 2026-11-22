import { join } from 'node:path'
import type { LibraryRepointResult } from './libraryRepointFlush'
import type { RekordboxRepoint } from './rekordboxBatch'
import { seratoPathOn, seratoRootOf, withCrateTrackRepointed } from './seratoCrateFile'
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
    const crate = bytes && withCrateTrackRepointed(bytes, from, to)
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
      return all('rekordbox-running')
    case 'backup-failed':
      return all('backup-failed')
    default:
      return all('write-failed')
  }
}
