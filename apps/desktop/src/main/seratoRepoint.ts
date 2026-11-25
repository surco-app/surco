import { join } from 'node:path'
import log from 'electron-log/main'
import type { LibraryRepointResult } from './libraryRepointFlush'
import type { RekordboxRepoint } from './rekordboxBatch'
import type { QueueApply, RekordboxQueue } from './rekordboxQueue'
import {
  crateTrackPaths,
  seratoPathOn,
  seratoRootOf,
  withCrateTrackRepointed,
  withCrateTracks,
} from './seratoCrateFile'
import { seratoDatabaseTruncated } from './seratoDatabase'
import { seratoDatabaseHas, withSeratoTrackRepointed } from './seratoDatabaseWrite'
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

// A crate already holding the new file only loses the old row, or the track would be in it
// twice. Null when the crate never held the old file.
function withoutTrack(bytes: Uint8Array, paths: string[], from: string): Uint8Array | null {
  const kept = paths.flatMap((path, i) =>
    path.normalize('NFC') === from.normalize('NFC') ? [] : [{ keep: i }],
  )
  return kept.length === paths.length ? null : withCrateTracks(bytes, kept)
}

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
  if (repointed && seratoDatabaseHas(database, to)) return { written: false, reason: 'occupied' }
  // A commit whose rollback failed can leave the database on the new file and a crate still
  // on the old one: the retry finds no old entry, and the crates must still follow it, or
  // they keep a path that is about to be retired.
  if (repointed) draft.write(databaseFile, repointed)
  else if (!seratoDatabaseHas(database, to)) return { written: false, reason: 'no-match' }

  const subcrates = join(root.dir, 'Subcrates')
  for (const name of draft.list(subcrates).filter((n) => n.endsWith('.crate'))) {
    const file = join(subcrates, name)
    const bytes = draft.read(file)
    const paths = bytes && crateTrackPaths(bytes)
    if (!bytes || !paths) return 'truncated'
    const crate = paths.some((path) => path.normalize('NFC') === to.normalize('NFC'))
      ? withoutTrack(bytes, paths, from)
      : withCrateTrackRepointed(bytes, from, to)
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
// not block or break the retire, so it is logged and abandoned and the original is simply kept.
// It runs through the library flush chain like every other queue apply.
export async function settleSeratoRepoint(
  path: string,
  deps: {
    queue: Pick<RekordboxQueue, 'holdsRepoint' | 'apply'>
    serial: <T>(task: () => Promise<T>) => Promise<T>
    isRunning: () => Promise<boolean>
    onApplied: (result: QueueApply) => void
  },
): Promise<void> {
  if (!deps.queue.holdsRepoint(path)) return
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const gaveUp = new Promise<undefined>((resolve) => {
      timer = setTimeout(() => {
        log.warn(`serato repoint gave up waiting before retiring ${path}`)
        resolve(undefined)
      }, SETTLE_TIMEOUT_MS)
    })
    const applying = deps.serial(() => deps.queue.apply(async () => !(await deps.isRunning())))
    const result = await Promise.race([applying, gaveUp])
    if (result) deps.onApplied(result)
  } catch (err) {
    log.warn(`serato repoint failed before retiring ${path}: ${String(err)}`)
  } finally {
    clearTimeout(timer)
  }
}
