import type { MusicFixOutcome, MusicReviewField } from '../shared/types'
import type { Activity } from './activity'
import type { MusicSetResult } from './applemusic'

// What the review's Activity rows need that the IPC calls do not carry: the title of each
// track (main only sees persistent ids) and which run a later undo belongs to.
export function createMusicReviewLog() {
  const titles = new Map<string, string>()
  const groups = new Map<string, string>()
  const backups = new Map<string, { group: string; title: string }>()
  const copies = new Map<string, { group: string; label: string }>()
  let runs = 0
  const titleOf = (persistentId: string) => titles.get(persistentId) ?? persistentId
  return {
    rememberTitles(entries: { persistentId: string; title: string }[]) {
      for (const e of entries) titles.set(e.persistentId, e.title)
    },
    titleOf,
    beginRun: () => `music-review-${++runs}`,
    rememberRun(group: string, outcomes: MusicFixOutcome[]) {
      for (const o of outcomes) {
        groups.set(o.persistentId, group)
        if (o.backupId) backups.set(o.backupId, { group, title: titleOf(o.persistentId) })
      }
    },
    groupOf: (persistentId: string) => groups.get(persistentId),
    backup: (id: string) => backups.get(id),
    rememberCopy(path: string, copy: { group: string; label: string }) {
      copies.set(path, copy)
    },
    copyOf: (path: string) => copies.get(path),
  }
}

export const musicReviewLog = createMusicReviewLog()

type MusicReviewLog = ReturnType<typeof createMusicReviewLog>

interface UndoDeps {
  track: Activity['track']
  log: MusicReviewLog
}

const UNDO_GROUP = 'music-review-undo'

// One field put back in Music by an undo, under the run it undoes.
export function setFieldLogged(
  persistentId: string,
  field: MusicReviewField,
  set: () => Promise<MusicSetResult>,
  { track, log }: UndoDeps,
): Promise<MusicSetResult> {
  return track('applemusic', `activity.reviewFix.${field}`, set, {
    labelParams: { title: log.titleOf(persistentId) },
    group: log.groupOf(persistentId) ?? UNDO_GROUP,
    groupLabelKey: 'activity.reviewUndoRun',
    summary: (answer) =>
      answer === 'set'
        ? { detailKey: 'activity.reviewUndoMusic' }
        : answer === 'mismatch'
          ? { detailKey: 'activity.reviewUndoMusicMismatch', status: 'warn' }
          : { detailKey: 'activity.reviewUndoMusicMissing', status: 'warn' },
  })
}

// A file the review backed up, restored by its undo. Any other restore (the Backups panel)
// stays out of the review's rows.
export function restoreLogged<T>(id: string, restore: () => Promise<T>, { track, log }: UndoDeps) {
  const backup = log.backup(id)
  if (!backup) return restore()
  return track('applemusic', 'activity.reviewUndoFile', restore, {
    labelParams: { title: backup.title },
    group: backup.group,
    groupLabelKey: 'activity.reviewUndoRun',
    summary: () => ({ detailKey: 'activity.reviewUndoFileRestored' }),
  })
}
