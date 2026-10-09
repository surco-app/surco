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
  revertMusic: (outcome: ReviewOutcome, fix: ReviewFix) => Promise<unknown>
  inMusic?: (id: string) => boolean
  facts?: (id: string) => TrackItem | undefined
  settle?: (updates: LibraryTagUpdate[], trashed: string[]) => void
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
