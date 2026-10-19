import type { TFunction } from 'i18next'
import type {
  RekordboxQueueApplied,
  RekordboxQueueNotice,
  RekordboxQueuePart,
  RekordboxQueueState,
} from '../../../shared/types'
import { refusalKey } from './playlistEdits'

const NOTICE_KEY: Record<RekordboxQueueNotice['code'], string> = {
  ambiguous: 'rekordboxQueue.notice.ambiguous',
  'file-missing': 'rekordboxQueue.notice.fileMissing',
  'not-added': 'rekordboxQueue.notice.notAdded',
  'playlist-changed': 'rekordboxQueue.notice.playlistChanged',
  'playlist-gone': 'rekordboxQueue.notice.playlistGone',
  'edit-changed': 'rekordboxQueue.notice.editChanged',
}

export function noticeText(tr: TFunction, notice: RekordboxQueueNotice): string {
  return tr(NOTICE_KEY[notice.code], notice)
}

export function pillText(tr: TFunction, state: RekordboxQueueState): string | null {
  if (state.tracks > 0) return tr('rekordboxQueue.pillTracks', { count: state.tracks })
  if (state.changes > 0) return tr('rekordboxQueue.pillChanges', { count: state.changes })
  return null
}

export function partText(tr: TFunction, part: RekordboxQueuePart): string {
  if (part.kind === 'playlists')
    return part.names.length > 0
      ? tr('rekordboxQueue.part.playlists', { names: part.names.join(', ') })
      : tr('rekordboxQueue.part.noPlaylists')
  if (part.kind === 'tree') return tr(`rekordboxQueue.part.tree.${part.edit}`)
  return tr(`rekordboxQueue.part.${part.kind}`)
}

export function appliedMessage(
  tr: TFunction,
  applied: RekordboxQueueApplied,
): { text: string; tone: 'neutral' | 'danger' } | null {
  if ('refused' in applied) {
    const key =
      applied.refused === 'backup-failed'
        ? 'rekordboxQueue.backupFailed'
        : applied.refused === 'nothing-to-add'
          ? null
          : refusalKey(applied.refused)
    return key ? { text: tr(key), tone: 'danger' } : null
  }
  const parts = [
    ...(applied.tracks > 0 ? [tr('rekordboxQueue.applied', { count: applied.tracks })] : []),
    ...(applied.tracks === 0 && applied.changes > 0
      ? [tr('rekordboxQueue.appliedChanges', { count: applied.changes })]
      : []),
    ...applied.notices.map((n) => noticeText(tr, n)),
  ]
  return parts.length > 0 ? { text: parts.join('. '), tone: 'neutral' } : null
}
