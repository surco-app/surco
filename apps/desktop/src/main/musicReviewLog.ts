import type {
  ActivityKind,
  MusicFixOutcome,
  MusicReviewField,
  ReviewOutcome,
} from '../shared/types'
import type { Activity } from './activity'
import type { MusicSetResult } from './applemusic'

// What the review's Activity rows need that the IPC calls do not carry: the title of each
// track (main only sees persistent ids) and which run a later undo belongs to.
export function createMusicReviewLog() {
  const titles = new Map<string, string>()
  const groups = new Map<string, string>()
  const backups = new Map<string, { group: string; title: string }>()
  const copies = new Map<string, { group: string; label: string }>()
  const listRuns = new Set<string>()
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
    beginListRun: () => `list-review-${++runs}`,
    // The list review keys its tracks by path; its undo comes back by Music id and backup.
    rememberListRun(
      group: string,
      outcomes: ReviewOutcome[],
      titleOfPath: (path: string) => string,
    ) {
      listRuns.add(group)
      for (const o of outcomes) {
        const title = titleOfPath(o.id)
        if (o.musicId) {
          groups.set(o.musicId, group)
          titles.set(o.musicId, title)
        }
        if (o.backupId) backups.set(o.backupId, { group, title })
      }
    },
    groupOf: (persistentId: string) => groups.get(persistentId),
    undoLabelOf: (group: string) =>
      listRuns.has(group) ? 'activity.listReviewUndoRun' : 'activity.reviewUndoRun',
    kindOf: (group: string): ActivityKind => (listRuns.has(group) ? 'review' : 'applemusic'),
    backup: (id: string) => backups.get(id),
    rememberCopy(path: string, copy: { group: string; label: string }) {
      copies.set(path, copy)
    },
    copyOf: (path: string) => copies.get(path),
  }
}

export const musicReviewLog = createMusicReviewLog()

export type MusicReviewLog = ReturnType<typeof createMusicReviewLog>

interface UndoDeps {
  track: Activity['track']
  log: MusicReviewLog
}

const UNDO_GROUP = 'music-review-undo'

export interface RunLog {
  track: Activity['track']
  // The run's own row in Activity, so hundreds of fixes fold under one entry.
  group: string
  // Apple Music when absent.
  kind?: ActivityKind
  titleOf: (id: string) => string
}

export type FieldEnding = {
  detailKey: string
  detailParams?: { error: string }
  status?: 'warn' | 'error'
}

// One row per field of one track under the run's row, each started with the track's work
// and ended by what became of that field.
export async function logFieldRows<O>(
  work: Promise<O>,
  { id, fields }: { id: string; fields: MusicReviewField[] },
  log: RunLog,
  run: { labelKey: string; count: number },
  endingOf: (outcome: O, index: number) => FieldEnding,
): Promise<O> {
  const title = log.titleOf(id)
  await Promise.all(
    fields.map((field, i) =>
      log.track(log.kind ?? 'applemusic', `activity.reviewFix.${field}`, () => work, {
        labelParams: { title },
        group: log.group,
        groupLabelKey: run.labelKey,
        groupLabelParams: { count: run.count },
        summary: (o) => endingOf(o, i),
      }),
    ),
  )
  return work
}

// One field put back in Music by an undo, under the run it undoes.
export function setFieldLogged(
  persistentId: string,
  field: MusicReviewField,
  set: () => Promise<MusicSetResult>,
  { track, log }: UndoDeps,
): Promise<MusicSetResult> {
  const group = log.groupOf(persistentId) ?? UNDO_GROUP
  return track(log.kindOf(group), `activity.reviewFix.${field}`, set, {
    labelParams: { title: log.titleOf(persistentId) },
    group,
    groupLabelKey: log.undoLabelOf(group),
    summary: (answer) =>
      answer === 'set'
        ? { detailKey: 'activity.reviewUndoMusic' }
        : answer === 'mismatch'
          ? { detailKey: 'activity.reviewUndoMusicMismatch', status: 'warn' }
          : { detailKey: 'activity.reviewUndoMusicMissing', status: 'warn' },
  })
}

// A file the review backed up, restored by its undo. The Backups panel restores through the
// same call, the review's own backups too, and stays out of the review's rows: it is not
// an undo of the run.
export function restoreLogged<T>(
  id: string,
  restore: () => Promise<T>,
  { track, log }: UndoDeps,
  from: 'undo' | 'panel',
) {
  const backup = log.backup(id)
  if (!backup || from !== 'undo') return restore()
  return track(log.kindOf(backup.group), 'activity.reviewUndoFile', restore, {
    labelParams: { title: backup.title },
    group: backup.group,
    groupLabelKey: log.undoLabelOf(backup.group),
    summary: () => ({ detailKey: 'activity.reviewUndoFileRestored' }),
  })
}
