import { type DjProgram, programOf } from '../../../shared/djProgram'
import type { ReplacedEntry } from '../../../shared/toReview'
import type { SaveCuesRequest, SourcePlaylistEntry } from '../../../shared/types'

const same = (a: string, b: string) => a.normalize('NFC') === b.normalize('NFC')

function pendingHere(entry: ReplacedEntry, program: DjProgram): boolean {
  return entry.pending.includes(program)
}

export function replacedEntryOf(
  replaced: readonly ReplacedEntry[],
  path: string,
  program: DjProgram,
): ReplacedEntry | undefined {
  return replaced.find(
    (entry) =>
      pendingHere(entry, program) && (same(entry.newPath, path) || same(entry.oldPath, path)),
  )
}

export function toReviewEntriesFor(
  all: readonly SourcePlaylistEntry[],
  replaced: readonly ReplacedEntry[],
  program: DjProgram,
): SourcePlaylistEntry[] {
  const listed: { row: SourcePlaylistEntry; entry: ReplacedEntry }[] = []
  for (const entry of replaced) {
    if (!pendingHere(entry, program)) continue
    const rows = all.filter(
      (row) =>
        !row.separator &&
        row.path !== null &&
        (same(row.path, entry.newPath) || same(row.path, entry.oldPath)) &&
        row.preview?.cues.length !== 0,
    )
    const row = rows.find((r) => r.path !== null && same(r.path, entry.newPath)) ?? rows[0]
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
