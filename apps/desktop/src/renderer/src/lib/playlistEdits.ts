import type { TFunction } from 'i18next'
import type {
  RekordboxEditRefusal,
  RekordboxEditResult,
  RekordboxPlaylistEdit,
  SourcePlaylistEntry,
} from '../../../shared/types'

// The move rule of the writer (rekordboxPlaylistEdit.moveInPlaylist, which applies it in
// SQL in main), written once for the renderer: the moved items keep their order and land
// before the target, every other item keeps its place. The optimistic reorder below and
// the list's drop (TrackList) both use it, so what the list draws is what main writes.
export function moveBefore<T>(
  items: readonly T[],
  keyOf: (item: T) => string | undefined,
  moving: ReadonlySet<string>,
  before: string | null,
): T[] | null {
  const isMoving = (item: T): boolean => {
    const key = keyOf(item)
    return key !== undefined && moving.has(key)
  }
  const moved = items.filter(isMoving)
  const rest = items.filter((item) => !isMoving(item))
  const at = before === null ? rest.length : rest.findIndex((item) => keyOf(item) === before)
  if (at === -1) return null
  return [...rest.slice(0, at), ...moved, ...rest.slice(at)]
}

// The playlist as it will read once a move is written.
export function movedEntries(
  entries: SourcePlaylistEntry[],
  linkIds: string[],
  beforeLinkId: string | null,
): SourcePlaylistEntry[] {
  return moveBefore(entries, (e) => e.linkId, new Set(linkIds), beforeLinkId) ?? entries
}

const REFUSED: Record<Exclude<RekordboxEditRefusal, 'nothing-to-add'>, string> = {
  cancelled: 'sources.edit.refused.cancelled',
  'rekordbox-running': 'sources.edit.refused.running',
  unreadable: 'sources.edit.refused.unreadable',
  'backup-failed': 'sources.edit.refused.backupFailed',
  'write-failed': 'sources.edit.refused.writeFailed',
  'write-unknown': 'sources.edit.refused.writeUnknown',
  'read-only': 'sources.edit.refused.readOnly',
  stale: 'sources.edit.refused.stale',
  'no-separator': 'sources.edit.refused.noSeparator',
}

export function refusalKey(reason: Exclude<RekordboxEditRefusal, 'nothing-to-add'>): string {
  return REFUSED[reason]
}

// The line the user reads after an edit, or null when the list itself already shows what
// happened. An add always reports, because tracks it could not add vanish from the gesture
// with no other trace.
export function editMessage(
  tr: TFunction,
  edit: RekordboxPlaylistEdit,
  result: RekordboxEditResult,
  playlistName: string,
): { text: string; tone: 'neutral' | 'danger' } | null {
  if (!result.applied && result.reason !== 'nothing-to-add')
    return { text: tr(REFUSED[result.reason]), tone: 'danger' }
  if (edit.kind !== 'add' || !result.report) return null
  const r = result.report
  const parts = [
    r.added > 0
      ? tr('sources.edit.added', { count: r.added, name: playlistName })
      : tr('sources.edit.noneAdded', { name: playlistName }),
  ]
  if (r.already > 0) parts.push(tr('sources.edit.already', { count: r.already }))
  if (r.notInCollection > 0)
    parts.push(tr('sources.edit.notInCollection', { count: r.notInCollection }))
  if (r.ambiguous > 0) parts.push(tr('sources.edit.ambiguous', { count: r.ambiguous }))
  return { text: parts.join('. '), tone: 'neutral' }
}
