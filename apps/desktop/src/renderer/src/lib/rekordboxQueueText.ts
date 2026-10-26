import type { TFunction } from 'i18next'
import type {
  RekordboxEditRefusal,
  RekordboxQueueApplied,
  RekordboxQueueNotice,
  RekordboxQueuePart,
  RekordboxQueueState,
} from '../../../shared/types'
import { formatTime } from './duration'
import { refusalKey } from './playlistEdits'

export interface QueueWords {
  pillTracks: string
  pillChanges: string
  pillHalted: string
  pillElsewhere: string
  halted: string
  elsewhere: string
  discardConfirm: string
  applied: string
  appliedChanges: string
  backupFailed: string
  refused: (reason: Exclude<RekordboxEditRefusal, 'nothing-to-add'>) => string
  notices: Record<RekordboxQueueNotice['code'], string>
}

export const REKORDBOX_QUEUE_WORDS: QueueWords = {
  pillTracks: 'rekordboxQueue.pillTracks',
  pillChanges: 'rekordboxQueue.pillChanges',
  pillHalted: 'rekordboxQueue.pillHalted',
  pillElsewhere: 'rekordboxQueue.pillElsewhere',
  halted: 'rekordboxQueue.halted',
  elsewhere: 'rekordboxQueue.elsewhere',
  discardConfirm: 'rekordboxQueue.discardConfirm',
  applied: 'rekordboxQueue.applied',
  appliedChanges: 'rekordboxQueue.appliedChanges',
  backupFailed: 'rekordboxQueue.backupFailed',
  refused: refusalKey,
  notices: {
    ambiguous: 'rekordboxQueue.notice.ambiguous',
    'file-missing': 'rekordboxQueue.notice.fileMissing',
    'not-added': 'rekordboxQueue.notice.notAdded',
    'playlist-changed': 'rekordboxQueue.notice.playlistChanged',
    'playlist-gone': 'rekordboxQueue.notice.playlistGone',
    'edit-changed': 'rekordboxQueue.notice.editChanged',
    'cues-changed': 'rekordboxQueue.notice.cuesChanged',
    'cues-too-many': 'rekordboxQueue.notice.cuesTooMany',
    'cues-invalid': 'rekordboxQueue.notice.cuesInvalid',
    'cues-calls-dropped': 'engineQueue.notice.callsDropped',
    'cues-slot-dropped': 'traktorQueue.notice.slotDropped',
    'cues-adjusted': 'rekordboxQueue.notice.cuesAdjusted',
    'cues-unfit': 'rekordboxQueue.notice.cuesUnfit',
  },
}

export const ENGINE_QUEUE_WORDS: QueueWords = {
  pillTracks: 'engineQueue.pillTracks',
  pillChanges: 'engineQueue.pillChanges',
  pillHalted: 'engineQueue.pillHalted',
  pillElsewhere: 'engineQueue.pillElsewhere',
  halted: 'engineQueue.halted',
  elsewhere: 'engineQueue.elsewhere',
  discardConfirm: 'engineQueue.discardConfirm',
  applied: 'engineQueue.applied',
  appliedChanges: 'engineQueue.appliedChanges',
  backupFailed: 'engineQueue.backupFailed',
  refused: (reason) =>
    reason === 'unreadable'
      ? 'engineQueue.unreadable'
      : reason === 'other-collection'
        ? 'engineQueue.otherLibrary'
        : 'engineQueue.writeFailed',
  notices: {
    ...REKORDBOX_QUEUE_WORDS.notices,
    'cues-changed': 'engineQueue.notice.cuesChanged',
  },
}

export function noticeText(
  tr: TFunction,
  notice: RekordboxQueueNotice,
  words: QueueWords = REKORDBOX_QUEUE_WORDS,
): string {
  if (notice.code === 'cues-calls-dropped')
    return tr(words.notices[notice.code], {
      track: notice.track,
      count: notice.calls.length,
      times: notice.calls.map((ms) => formatTime(ms / 1000)).join(', '),
    })
  if (notice.code === 'cues-adjusted')
    return tr(words.notices[notice.code], { ...notice, count: notice.moved })
  return tr(words.notices[notice.code], notice)
}

export function pillText(
  tr: TFunction,
  state: RekordboxQueueState,
  words: QueueWords = REKORDBOX_QUEUE_WORDS,
): string | null {
  if (state.halted) return tr(words.pillHalted)
  if (state.elsewhere) return tr(words.pillElsewhere)
  if (state.tracks > 0) return tr(words.pillTracks, { count: state.tracks })
  if (state.changes > 0) return tr(words.pillChanges, { count: state.changes })
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

export interface CueSpot {
  contentId: string
  ms: number
}

export function appliedMessage(
  tr: TFunction,
  applied: RekordboxQueueApplied,
  words: QueueWords = REKORDBOX_QUEUE_WORDS,
): { text: string; tone: 'neutral' | 'danger'; goTo?: CueSpot } | null {
  if ('refused' in applied) {
    const key =
      applied.refused === 'backup-failed'
        ? words.backupFailed
        : applied.refused === 'nothing-to-add'
          ? null
          : words.refused(applied.refused)
    return key ? { text: tr(key), tone: 'danger' } : null
  }
  const parts = [
    ...(applied.tracks > 0 ? [tr(words.applied, { count: applied.tracks })] : []),
    ...(applied.tracks === 0 && applied.changes > 0
      ? [tr(words.appliedChanges, { count: applied.changes })]
      : []),
    ...applied.notices.map((n) => noticeText(tr, n, words)),
  ]
  if (parts.length === 0) return null
  const unfit = applied.notices.find((n) => n.code === 'cues-unfit')
  return {
    text: parts.join('. '),
    tone: 'neutral',
    ...(unfit ? { goTo: { contentId: unfit.contentId, ms: unfit.ms } } : {}),
  }
}
