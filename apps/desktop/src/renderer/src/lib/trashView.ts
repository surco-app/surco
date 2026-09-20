import type { TrashEntry, TrashReason } from '../../../shared/types'
import { foldText } from './normalizeText'

// What the trash panel shows out of what the trash holds: the reason filter behind the
// sidebar, the search box, and the countdown a row prints. Kept out of the component so
// the rules can be stated once and tested without rendering a dialog.

const DAY_MS = 24 * 60 * 60 * 1000

export type TrashFilter = TrashReason | 'all'

export const TRASH_FILTERS: TrashFilter[] = [
  'all',
  'replaced',
  'renamed',
  'deleted',
  'restored-over',
]

// The last week of the retention, and the only span a row says anything about time in.
// A day count on every row repeats what the sidebar already says once; drawn only here,
// it reads as a warning instead of decoration.
export const EXPIRING_SOON_DAYS = 7

// Whole days before the sweep takes this entry. Rounded UP so a partly spent day still
// counts as available — showing 28 for 28.4 days left would put the file closer to
// deletion than it is. Floored at zero: the sweep only runs at launch, so an entry past
// its retention stays listed until then and must not read as a negative countdown.
export function daysLeft(entry: TrashEntry, retentionDays: number, now = Date.now()): number {
  const elapsed = now - entry.trashedAt
  return Math.max(0, Math.ceil(retentionDays - elapsed / DAY_MS))
}

// The rows on screen: the chosen reason, then the query over the name and the folder it
// came from. The folder matters as much as the name — a bad batch is looked up by the
// crate it damaged, and every file in that crate is named differently.
export function visibleEntries(
  entries: TrashEntry[],
  filter: TrashFilter,
  query: string,
): TrashEntry[] {
  const q = foldText(query)
  return entries.filter((entry) => {
    if (filter !== 'all' && entry.reason !== filter) return false
    if (!q) return true
    return foldText(`${entry.name} ${entry.originalPath}`).includes(q)
  })
}

// The sidebar's counts. Taken from the whole trash, never from the filtered rows: a
// count that shrinks as you type stops answering "what is in here".
export function countByReason(entries: TrashEntry[]): Record<TrashFilter, number> {
  const counts: Record<TrashFilter, number> = {
    all: entries.length,
    replaced: 0,
    renamed: 0,
    deleted: 0,
    'restored-over': 0,
  }
  for (const entry of entries) counts[entry.reason]++
  return counts
}
