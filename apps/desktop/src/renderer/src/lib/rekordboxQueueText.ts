import type { TFunction } from 'i18next'
import type {
  RekordboxEditRefusal,
  RekordboxQueueApplied,
  RekordboxQueueNotice,
  RekordboxQueuePart,
  RekordboxQueueState,
} from '../../../shared/types'
import { refusalKey } from './playlistEdits'

export interface NoticeWords {
  title: string
  why?: string
}

export interface QueueWords {
  program: string
  pillTracks: string
  pillChanges: string
  pillTracksUnplugged: string
  pillChangesUnplugged: string
  pillHalted: string
  pillElsewhere: string
  halted: string
  elsewhere: string
  discardConfirm: string
  applied: string
  appliedChanges: string
  backupFailed: string
  refused: (reason: Exclude<RekordboxEditRefusal, 'nothing-to-add'>) => string
  notices: Record<RekordboxQueueNotice['code'], NoticeWords>
  parts?: { collection: string; noPlaylists: string }
}

// One title per outcome and one reason per cause, with the program named in the text: a
// batch is read as one row per reason, so every program says the same thing its own way.
const NOTICES: Record<RekordboxQueueNotice['code'], NoticeWords> = {
  ambiguous: { title: 'queueNotice.notAdded', why: 'queueNotice.why.twice' },
  'file-missing': { title: 'queueNotice.notAdded', why: 'queueNotice.why.fileGone' },
  'not-added': { title: 'queueNotice.notAdded', why: 'queueNotice.why.unreadable' },
  'playlist-changed': { title: 'queueNotice.notChangedIn', why: 'queueNotice.why.listChanged' },
  'playlist-gone': { title: 'queueNotice.notAddedToList', why: 'queueNotice.why.listGone' },
  'edit-changed': { title: 'queueNotice.listNotChanged', why: 'queueNotice.why.listChanged' },
  'other-volume': { title: 'queueNotice.notAddedToList', why: 'queueNotice.why.otherDrive' },
  'source-in-serato': { title: 'queueNotice.notAddedToList', why: 'queueNotice.why.originalKept' },
  'source-in-virtualdj': {
    title: 'queueNotice.notAddedToList',
    why: 'queueNotice.why.originalKept',
  },
  'cues-changed': { title: 'queueNotice.cuesNotSaved', why: 'queueNotice.why.markAgain' },
  'cues-too-many': { title: 'queueNotice.cuesNotSaved', why: 'queueNotice.why.tooMany' },
  'cues-invalid': { title: 'queueNotice.cuesNotSaved', why: 'queueNotice.why.notCues' },
  'cues-write-failed': { title: 'queueNotice.cuesNotSaved', why: 'queueNotice.why.notWritten' },
  'cues-old-block': { title: 'queueNotice.cuesNotSaved', why: 'queueNotice.why.oldBlock' },
  'cues-calls-dropped': { title: 'queueNotice.callsNotSaved', why: 'queueNotice.why.hotCuesOnly' },
  'cues-slot-dropped': { title: 'queueNotice.cueHNotSaved', why: 'queueNotice.why.sevenButtons' },
  'cues-adjusted': { title: 'queueNotice.cuesMoved', why: 'queueNotice.why.furthest' },
  'cues-unfit': { title: 'queueNotice.cuesOffBeats', why: 'queueNotice.why.leftInPlace' },
  'not-in-library': { title: 'queueNotice.notInLibrary', why: 'queueNotice.why.playlistsKept' },
  'tags-not-in-library': { title: 'queueNotice.notInLibrary', why: 'queueNotice.why.tagsKept' },
  'tags-changed': { title: 'queueNotice.tagsNotChanged', why: 'queueNotice.why.tagsChanged' },
  'repoint-other-volume': { title: 'queueNotice.keptOriginal', why: 'queueNotice.why.otherDrive' },
  'repoint-song-taken': { title: 'queueNotice.keptOriginal', why: 'queueNotice.why.songTaken' },
  'repoint-unwritable': { title: 'queueNotice.keptOriginal', why: 'queueNotice.why.lengthUnfit' },
  'repoint-song-taken-gone': {
    title: 'queueNotice.oldSongMissing',
    why: 'queueNotice.why.songTakenGone',
  },
}

export const REKORDBOX_QUEUE_WORDS: QueueWords = {
  program: 'rekordbox',
  pillTracks: 'rekordboxQueue.pillTracks',
  pillChanges: 'rekordboxQueue.pillChanges',
  pillTracksUnplugged: 'rekordboxQueue.pillTracksUnplugged',
  pillChangesUnplugged: 'rekordboxQueue.pillChangesUnplugged',
  pillHalted: 'rekordboxQueue.pillHalted',
  pillElsewhere: 'rekordboxQueue.pillElsewhere',
  halted: 'rekordboxQueue.halted',
  elsewhere: 'rekordboxQueue.elsewhere',
  discardConfirm: 'rekordboxQueue.discardConfirm',
  applied: 'rekordboxQueue.applied',
  appliedChanges: 'rekordboxQueue.appliedChanges',
  backupFailed: 'rekordboxQueue.backupFailed',
  refused: refusalKey,
  notices: NOTICES,
}

export const ENGINE_QUEUE_WORDS: QueueWords = {
  program: 'Engine DJ',
  pillTracks: 'engineQueue.pillTracks',
  pillChanges: 'engineQueue.pillChanges',
  pillTracksUnplugged: 'engineQueue.pillTracksUnplugged',
  pillChangesUnplugged: 'engineQueue.pillChangesUnplugged',
  pillHalted: 'engineQueue.pillHalted',
  pillElsewhere: 'engineQueue.pillElsewhere',
  halted: 'engineQueue.halted',
  elsewhere: 'engineQueue.elsewhere',
  discardConfirm: 'engineQueue.discardConfirm',
  applied: 'engineQueue.applied',
  appliedChanges: 'engineQueue.appliedChanges',
  backupFailed: 'engineQueue.backupFailed',
  refused: (reason) =>
    reason === 'unreadable' ? 'engineQueue.unreadable' : 'engineQueue.writeFailed',
  notices: NOTICES,
}

export const TRAKTOR_QUEUE_WORDS: QueueWords = {
  program: 'Traktor',
  pillTracks: 'traktorQueue.pillTracks',
  pillChanges: 'traktorQueue.pillChanges',
  pillTracksUnplugged: 'traktorQueue.pillTracksUnplugged',
  pillChangesUnplugged: 'traktorQueue.pillChangesUnplugged',
  pillHalted: 'traktorQueue.pillHalted',
  pillElsewhere: 'traktorQueue.pillElsewhere',
  halted: 'traktorQueue.halted',
  elsewhere: 'traktorQueue.elsewhere',
  discardConfirm: 'traktorQueue.discardConfirm',
  applied: 'traktorQueue.applied',
  appliedChanges: 'traktorQueue.appliedChanges',
  backupFailed: 'traktorQueue.backupFailed',
  refused: (reason) =>
    reason === 'unreadable' ? 'traktorQueue.unreadable' : 'traktorQueue.writeFailed',
  notices: NOTICES,
}

// Serato and VirtualDJ give no reason when a converted track stays out, so the row only
// names it.
export const SERATO_QUEUE_WORDS: QueueWords = {
  program: 'Serato',
  pillTracks: 'seratoQueue.pillTracks',
  pillChanges: 'seratoQueue.pillChanges',
  pillTracksUnplugged: 'seratoQueue.pillTracks',
  pillChangesUnplugged: 'seratoQueue.pillChanges',
  pillHalted: 'seratoQueue.pillHalted',
  pillElsewhere: 'seratoQueue.pillTracks',
  halted: 'seratoQueue.writeUnknown',
  elsewhere: 'seratoQueue.pillTracks',
  discardConfirm: 'seratoQueue.discardConfirm',
  applied: 'seratoQueue.applied',
  appliedChanges: 'seratoQueue.appliedChanges',
  backupFailed: 'seratoQueue.writeFailed',
  refused: (reason) =>
    reason === 'write-unknown' ? 'seratoQueue.writeUnknown' : 'seratoQueue.writeFailed',
  notices: { ...NOTICES, 'not-added': { title: 'queueNotice.notAdded' } },
  parts: {
    collection: 'seratoQueue.part.collection',
    noPlaylists: 'seratoQueue.part.noPlaylists',
  },
}

export const VIRTUALDJ_QUEUE_WORDS: QueueWords = {
  program: 'VirtualDJ',
  pillTracks: 'virtualdjQueue.pillTracks',
  pillChanges: 'virtualdjQueue.pillChanges',
  pillTracksUnplugged: 'virtualdjQueue.pillTracksUnplugged',
  pillChangesUnplugged: 'virtualdjQueue.pillChangesUnplugged',
  pillHalted: 'virtualdjQueue.pillHalted',
  pillElsewhere: 'virtualdjQueue.pillElsewhere',
  halted: 'virtualdjQueue.writeUnknown',
  elsewhere: 'virtualdjQueue.elsewhere',
  discardConfirm: 'virtualdjQueue.discardConfirm',
  applied: 'virtualdjQueue.applied',
  appliedChanges: 'virtualdjQueue.appliedChanges',
  backupFailed: 'virtualdjQueue.writeFailed',
  refused: (reason) =>
    reason === 'write-unknown' ? 'virtualdjQueue.writeUnknown' : 'virtualdjQueue.writeFailed',
  notices: {
    ...NOTICES,
    'not-added': { title: 'queueNotice.notAdded' },
    'not-in-library': { title: 'queueNotice.notInLibrary', why: 'queueNotice.why.cuesKept' },
  },
  parts: {
    collection: 'virtualdjQueue.part.collection',
    noPlaylists: 'virtualdjQueue.part.noPlaylists',
  },
}

export function pillText(
  tr: TFunction,
  state: RekordboxQueueState,
  words: QueueWords = REKORDBOX_QUEUE_WORDS,
): string | null {
  if (state.halted) return tr(words.pillHalted)
  const tracks = state.unplugged ? words.pillTracksUnplugged : words.pillTracks
  const changes = state.unplugged ? words.pillChangesUnplugged : words.pillChanges
  if (state.tracks > 0) return tr(tracks, { count: state.tracks })
  if (state.changes > 0) return tr(changes, { count: state.changes })
  if (state.elsewhere) return tr(words.pillElsewhere, { count: state.elsewhere })
  return null
}

export function partText(
  tr: TFunction,
  part: RekordboxQueuePart,
  words: QueueWords = REKORDBOX_QUEUE_WORDS,
): string {
  if (part.kind === 'playlists')
    return part.names.length > 0
      ? tr('rekordboxQueue.part.playlists', { names: part.names.join(', ') })
      : tr(words.parts?.noPlaylists ?? 'rekordboxQueue.part.noPlaylists')
  if (part.kind === 'collection' && words.parts) return tr(words.parts.collection)
  if (part.kind === 'tree') return tr(`rekordboxQueue.part.tree.${part.edit}`)
  return tr(`rekordboxQueue.part.${part.kind}`)
}

export interface CueSpot {
  contentId: string
  ms: number
}

export interface QueueRow {
  icon: 'list' | 'cue' | 'tag'
  tone: 'warn' | 'neutral'
  title: string
  sub: string
  goTo?: CueSpot
}

// What a notice adds to its row's count: the cues or CALLs it is about where it names
// them, one track otherwise.
function weight(notice: RekordboxQueueNotice): number {
  if (notice.code === 'cues-calls-dropped') return notice.calls.length
  if (notice.code === 'cues-adjusted') return notice.moved
  if (notice.code === 'cues-unfit') return notice.count
  return 1
}

function noticeRows(tr: TFunction, notices: RekordboxQueueNotice[], words: QueueWords): QueueRow[] {
  const groups = new Map<string, RekordboxQueueNotice[]>()
  for (const notice of notices) {
    const key = `${notice.code}\u0000${'playlist' in notice ? notice.playlist : ''}`
    groups.set(key, [...(groups.get(key) ?? []), notice])
  }
  return [...groups.values()].map(([first, ...rest]) => {
    const group = [first, ...rest]
    const values = {
      program: words.program,
      playlist: 'playlist' in first ? first.playlist : '',
      count: group.reduce((sum, n) => sum + weight(n), 0),
      maxMs: Math.max(...group.map((n) => (n.code === 'cues-adjusted' ? n.maxMs : 0))),
    }
    const said = words.notices[first.code]
    const names = [...new Set(group.flatMap((n) => ('track' in n ? [n.track] : [])))]
    return {
      icon: first.code.startsWith('cues-')
        ? 'cue'
        : first.code.startsWith('tags-')
          ? 'tag'
          : 'list',
      tone: first.code === 'cues-adjusted' ? 'neutral' : 'warn',
      title: tr(said.title, values),
      sub: [said.why ? tr(said.why, values) : '', names.join(', ')].filter(Boolean).join(' · '),
      ...(first.code === 'cues-unfit'
        ? { goTo: { contentId: first.contentId, ms: first.ms } }
        : {}),
    }
  })
}

export function appliedMessage(
  tr: TFunction,
  applied: RekordboxQueueApplied,
  words: QueueWords = REKORDBOX_QUEUE_WORDS,
): { text: string; tone: 'neutral' | 'danger'; rows?: QueueRow[] } | null {
  if ('refused' in applied) {
    const key =
      applied.refused === 'backup-failed'
        ? words.backupFailed
        : applied.refused === 'nothing-to-add'
          ? null
          : words.refused(applied.refused)
    return key ? { text: tr(key), tone: 'danger' } : null
  }
  const text =
    applied.tracks > 0
      ? tr(words.applied, { count: applied.tracks })
      : applied.changes > 0
        ? tr(words.appliedChanges, { count: applied.changes })
        : ''
  const rows = noticeRows(tr, applied.notices, words)
  if (!text && rows.length === 0) return null
  return { text, tone: 'neutral', rows }
}
