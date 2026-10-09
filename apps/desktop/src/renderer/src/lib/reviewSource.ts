import type {
  DuplicateReplaceOutcome,
  LibraryTagUpdate,
  MusicFixOutcome,
  MusicFixProgress,
  MusicReviewEntry,
  RemoveCopyResult,
  ReviewEntry,
  ReviewFix,
  ReviewOutcome,
} from '../../../shared/types'
import type { TrackItem } from '../types'

export interface ReviewLoad {
  entries: ReviewEntry[]
  skipped: number
  // Undefined where there is no Music; false when it was closed and not opened to ask.
  musicConsulted?: boolean
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
  ) => Promise<'set' | 'missing' | 'mismatch' | undefined>
  inMusic?: (id: string) => boolean
  // Whether the Music answer inMusic reads came from Music; undefined where there is none.
  musicConsulted?: () => boolean | undefined
  facts?: (id: string) => TrackItem | undefined
  settle?: (updates: LibraryTagUpdate[], trashed: string[]) => void
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
