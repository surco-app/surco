import type { CueProgram, ReadOnlyProgram } from '../../../shared/djProgram'
import type {
  DamageOutcome,
  DamageRepairItem,
  DamageScan,
  DuplicateReplaceOutcome,
  MusicFixOutcome,
  MusicFixProgress,
  MusicReviewEntry,
  RemoveCopyResult,
  ReviewEntry,
  ReviewedFileUpdate,
  ReviewFix,
  ReviewOutcome,
} from '../../../shared/types'
import type { TrackItem } from '../types'
import { recordingKey } from './duplicates'
import {
  type IncompleteFinding,
  type IncompleteRowDeps,
  incompleteOfRows,
} from './incompleteReview'

export interface ReviewLoad {
  entries: ReviewEntry[]
  skipped: number
  leftOut?: Record<ReadOnlyProgram, number>
  // Undefined where there is no Music; false when it was closed and not opened to ask.
  musicConsulted?: boolean
  incomplete?: IncompleteFinding[]
}

export interface ReviewRemoval {
  removeId: string
  keepId: string
  label: string
  keepLabel: string
}

export interface ReviewRemovalRun {
  removed: RemoveCopyResult[]
  replaced: DuplicateReplaceOutcome[]
  librariesUntouched: boolean
  replaceFailed: boolean
}

export interface RemovalHooks {
  isCancelled: () => boolean
  onStep: (current: number) => void
  onDone: (done: number) => void
  onLibraries: () => void
  onCheckingMusic?: () => void
}

export interface ReviewSource {
  kind: 'music' | 'list'
  load: () => Promise<ReviewLoad>
  locate: (id: string) => Promise<string>
  applyFixes: (fixes: ReviewFix[]) => Promise<ReviewOutcome[]>
  onProgress: (cb: (p: MusicFixProgress) => void) => () => void
  cancel: () => void
  removeCopies: (removals: ReviewRemoval[], hooks: RemovalHooks) => Promise<ReviewRemovalRun>
  // What Music answered; undefined when the track has no Music entry to put back.
  revertMusic: (
    outcome: ReviewOutcome,
    fix: ReviewFix,
  ) => Promise<'set' | 'held' | 'missing' | 'mismatch' | undefined>
  inMusic?: (id: string) => boolean
  // Whether the Music answer inMusic reads came from Music; undefined where there is none.
  musicConsulted?: () => boolean | undefined
  facts?: (id: string) => TrackItem | undefined
  settle?: (updates: ReviewedFileUpdate[], trashed: string[]) => void
  loadDamage?: () => Promise<DamageScan>
  repairDamage?: (
    items: DamageRepairItem[],
    reviewAsks?: readonly CueProgram[],
  ) => Promise<DamageOutcome[]>
}

// The texts that name where the review reads and writes: Music and its library, or the
// list and its files.
export interface ReviewCopy {
  loading: string
  empty: string
  error: string
  phaseWriting: string
  phaseVerifying: string
  confirmRemoved: string
  confirmPlaylists: string
  confirmTrash: string
  doneTitle: string
  applyError: string
  partial: string
  librarySkipped: string
  libraryReplaceFailed: string
  whereMusic: string
}

export const REVIEW_COPY: Record<ReviewSource['kind'], ReviewCopy> = {
  music: {
    loading: 'musicReview.loading',
    empty: 'musicReview.empty',
    error: 'musicReview.error',
    phaseWriting: 'musicReview.phase.writing',
    phaseVerifying: 'musicReview.phase.verifying',
    confirmRemoved: 'musicReview.confirm.removed',
    confirmPlaylists: 'musicReview.confirm.playlists',
    confirmTrash: 'musicReview.confirm.trash',
    doneTitle: 'musicReview.done.title',
    applyError: 'musicReview.done.applyError',
    partial: 'musicReview.done.where.musicOnly',
    librarySkipped: 'musicReview.done.librarySkipped',
    libraryReplaceFailed: 'musicReview.done.libraryReplaceFailed',
    whereMusic: 'musicReview.where.music',
  },
  list: {
    loading: 'listReview.loading',
    empty: 'listReview.empty',
    error: 'listReview.error',
    phaseWriting: 'listReview.phase.writing',
    phaseVerifying: 'listReview.phase.verifying',
    confirmRemoved: 'listReview.confirm.removed',
    confirmPlaylists: 'listReview.confirm.playlists',
    confirmTrash: 'listReview.confirm.trash',
    doneTitle: 'listReview.done.title',
    applyError: 'listReview.done.applyError',
    partial: 'listReview.done.partial',
    librarySkipped: 'listReview.done.librarySkipped',
    libraryReplaceFailed: 'listReview.done.libraryReplaceFailed',
    whereMusic: 'listReview.where.music',
  },
}

const FAILED_REMOVAL: RemoveCopyResult = { outcome: 'failed', playlists: 0, fileTrashed: false }

const entryOf = ({ persistentId, ...rest }: MusicReviewEntry): ReviewEntry => ({
  id: persistentId,
  ...rest,
})

const outcomeOf = ({ persistentId, fixes, ...rest }: MusicFixOutcome): ReviewOutcome => ({
  ...rest,
  id: persistentId,
  musicId: persistentId,
  fixes: fixes.map(({ persistentId: id, ...fix }) => ({ id, ...fix })),
})

// The library review as it always ran: every call is the IPC the hook made itself before
// the list review needed a second source.
export const musicSource: ReviewSource = {
  kind: 'music',
  load: async () => ({ entries: (await window.api.loadMusicReview()).map(entryOf), skipped: 0 }),
  locate: (id) => window.api.appleMusicEntryLocation(id),
  applyFixes: async (fixes) =>
    (
      await window.api.applyMusicFixes(
        fixes.map(({ id, ...fix }) => ({ persistentId: id, ...fix })),
      )
    ).map(outcomeOf),
  onProgress: (cb) => window.api.onMusicFixProgress(cb),
  cancel: () => {
    void window.api.cancelMusicFixes()
  },
  removeCopies: async (removals, { isCancelled, onStep, onDone, onLibraries }) => {
    const removed: RemoveCopyResult[] = []
    for (const r of removals) {
      if (isCancelled()) break
      onStep(removed.length + 1)
      removed.push(
        await window.api
          .removeMusicDuplicate({
            removePid: r.removeId,
            keepPid: r.keepId,
            label: r.label,
            keepLabel: r.keepLabel,
          })
          .catch(() => FAILED_REMOVAL),
      )
      onDone(removed.length)
    }
    const pairs = removed.flatMap((r) => (r.pair ? [r.pair] : []))
    const run: ReviewRemovalRun = {
      removed,
      replaced: [],
      librariesUntouched: false,
      replaceFailed: false,
    }
    if (pairs.length === 0) return run
    if (isCancelled()) return { ...run, librariesUntouched: true }
    onLibraries()
    let replaceFailed = false
    const replaced: DuplicateReplaceOutcome[] = await window.api
      .replaceDuplicatesInLibraries(pairs)
      .catch(() => {
        replaceFailed = true
        return []
      })
    return { ...run, replaced, replaceFailed }
  },
  revertMusic: (_outcome, fix) => window.api.setMusicField(fix.id, fix.field, fix.to, fix.from),
}

// What a review opened from a Music playlist reads. 'tracks' is the playlist's own entries;
// 'duplicates' adds every library entry of the same recording as one of them, because the
// copy to delete usually sits outside the playlist. A recording is kept whole, never part
// of it, so each group comes out with the members, and so the key, the whole library gives
// it: a group ignored there stays ignored here.
export type MusicScopeMode = 'tracks' | 'duplicates'

export function scopeMusicEntries(
  entries: ReviewEntry[],
  ids: ReadonlySet<string>,
  mode: MusicScopeMode,
): ReviewEntry[] {
  if (mode === 'tracks') return entries.filter((e) => ids.has(e.id))
  const keys = new Set<string>()
  for (const e of entries) {
    const key = ids.has(e.id) ? recordingKey(e.artist, e.title) : null
    if (key) keys.add(key)
  }
  return entries.filter((e) => {
    if (ids.has(e.id)) return true
    const key = recordingKey(e.artist, e.title)
    return key !== null && keys.has(key)
  })
}

// Music answers for the whole library in one bulk dump, and the duplicates of a playlist
// need that whole library anyway, so the dump is read as before and narrowed here instead of
// a second AppleScript that reads one playlist. Everything else is the library review.
export function scopedMusicSource(
  ids: ReadonlySet<string>,
  mode: MusicScopeMode,
  incomplete?: IncompleteRowDeps & { rows: () => TrackItem[] },
): ReviewSource {
  const changes: ReviewedFileUpdate[] = []
  const idOf = (row: TrackItem) =>
    row.musicPersistentId && ids.has(row.musicPersistentId) ? row.musicPersistentId : undefined
  return {
    ...musicSource,
    load: async () => {
      const loaded = await musicSource.load()
      return {
        ...loaded,
        entries: scopeMusicEntries(loaded.entries, ids, mode),
        ...(incomplete && {
          incomplete: incompleteOfRows(incomplete.rows(), idOf, changes, incomplete),
        }),
      }
    },
    settle: (updates) => {
      changes.push(...updates)
    },
  }
}
