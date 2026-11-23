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
  return replaced.find(
    (entry) =>
      pendingHere(entry, program) && (nfc(entry.newPath) === p || nfc(entry.oldPath) === p),
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
  const listed: { row: SourcePlaylistEntry; entry: ReplacedEntry }[] = []
  for (const entry of replaced) {
    if (!pendingHere(entry, program)) continue
    const row = byPath.get(nfc(entry.newPath)) ?? byPath.get(nfc(entry.oldPath))
    if (row) listed.push({ row, entry })
  }
  const unmoved = (entry: ReplacedEntry) => ('unmoved' in entry.shift ? 0 : 1)
  return listed
    .sort((a, b) => unmoved(a.entry) - unmoved(b.entry) || b.entry.replacedAt - a.entry.replacedAt)
    .map(({ row }) => row)
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
