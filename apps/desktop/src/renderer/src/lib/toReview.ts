import { type DjProgram, programOf } from '../../../shared/djProgram'
import type { ReplacedEntry } from '../../../shared/toReview'
import type { SaveCuesRequest, SourcePlaylistEntry } from '../../../shared/types'

const nfc = (p: string) => p.normalize('NFC')

function pendingHere(entry: ReplacedEntry, program: DjProgram): boolean {
  return entry.pending.includes(program)
}

export function replacedEntryOf(
  replaced: readonly ReplacedEntry[],
  path: string,
  program: DjProgram,
): ReplacedEntry | undefined {
  const p = nfc(path)
  const here = replaced.filter((entry) => pendingHere(entry, program))
  // A file can be one track's new copy and another's old one: it is the first's.
  return (
    here.find((entry) => nfc(entry.newPath) === p) ??
    here.find((entry) => entry.formerPaths?.some((f) => nfc(f) === p)) ??
    here.find((entry) => nfc(entry.oldPath) === p)
  )
}

// The list is recomputed on every tab, save and Reviewed, and a library holds tens of
// thousands of rows: each library is indexed by path once, then every entry is a lookup.
const indexes = new WeakMap<readonly SourcePlaylistEntry[], Map<string, SourcePlaylistEntry>>()

function reviewableByPath(all: readonly SourcePlaylistEntry[]): Map<string, SourcePlaylistEntry> {
  const known = indexes.get(all)
  if (known) return known
  const byPath = new Map<string, SourcePlaylistEntry>()
  for (const row of all) {
    if (row.separator || row.path === null || row.preview?.cues.length === 0) continue
    const p = nfc(row.path)
    if (!byPath.has(p)) byPath.set(p, row)
  }
  indexes.set(all, byPath)
  return byPath
}

export function toReviewEntriesFor(
  all: readonly SourcePlaylistEntry[],
  replaced: readonly ReplacedEntry[],
  program: DjProgram,
): SourcePlaylistEntry[] {
  const byPath = reviewableByPath(all)
  const here = replaced
    .filter((entry) => pendingHere(entry, program))
    .map((entry) => ({
      entry,
      now: nfc(entry.newPath),
      before: [...(entry.formerPaths ?? []).map(nfc).reverse(), nfc(entry.oldPath)],
    }))
  // A file that is one track's new copy and another's old one is listed for the first only.
  // Before the new copy come the paths a queued program may still show, latest first.
  const newCopies = new Set(here.map(({ now }) => now))
  const listed: { row: SourcePlaylistEntry; entry: ReplacedEntry }[] = []
  for (const { entry, now, before } of here) {
    const row =
      byPath.get(now) ??
      before.map((p) => (newCopies.has(p) ? undefined : byPath.get(p))).find(Boolean)
    if (row) listed.push({ row, entry })
  }
  const unmoved = (entry: ReplacedEntry) => ('unmoved' in entry.shift ? 0 : 1)
  return listed
    .sort((a, b) => unmoved(a.entry) - unmoved(b.entry) || b.entry.replacedAt - a.entry.replacedAt)
    .map(({ row }) => row)
}

// Vicent's call (option B): a track that leaves To review while the DJ has it selected keeps
// its row, in its place, until they pick another one. Reviewed or a save is their last look at
// it, and the editor closing under them hid the Saved mark and lost their place.
export function keepOpenRows(
  before: readonly SourcePlaylistEntry[],
  now: SourcePlaylistEntry[],
  open: ReadonlySet<string>,
): SourcePlaylistEntry[] {
  if (open.size === 0) return now
  const listed = new Set(now.flatMap((e) => (e.path ? [nfc(e.path)] : [])))
  const kept = [...now]
  before.forEach((e, i) => {
    if (e.path && open.has(nfc(e.path)) && !listed.has(nfc(e.path)))
      kept.splice(Math.min(i, kept.length), 0, e)
  })
  return kept.length === now.length ? now : kept
}

export function savedReviews(
  reqs: readonly Pick<SaveCuesRequest, 'contentId' | 'path'>[],
): [path: string, programs: DjProgram[]][] {
  const byPath = new Map<string, DjProgram[]>()
  for (const { contentId, path } of reqs) {
    const programs = byPath.get(path) ?? []
    const program = programOf(contentId)
    if (!programs.includes(program)) programs.push(program)
    byPath.set(path, programs)
  }
  return [...byPath]
}

export function shiftLabel(ms: number): string {
  if (ms > 0) return `+${ms} ms`
  if (ms < 0) return `−${-ms} ms`
  return '0 ms'
}
