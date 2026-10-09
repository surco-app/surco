import type {
  MusicFieldFix,
  MusicFieldOutcome,
  MusicFixOutcome,
  MusicFixProgress,
  MusicReviewField,
  TrashEntry,
} from '../shared/types'
import type { Activity } from './activity'
import type { MusicSetResult } from './applemusic'
import type { FieldWrite, TagFieldChange } from './musicFieldWrite'

export interface ApplyDeps {
  setField: (
    persistentId: string,
    field: MusicReviewField,
    from: string,
    to: string,
  ) => Promise<MusicSetResult>
  locate: (persistentId: string) => Promise<string>
  exists: (path: string) => Promise<boolean>
  rewrite: (
    file: string,
    changes: TagFieldChange[],
  ) => Promise<{ outcomes: FieldWrite[]; backup?: TrashEntry }>
}

export interface ApplyLog {
  track: Activity['track']
  // The run's own row in Activity, so hundreds of fixes fold under one entry.
  group: string
  titleOf: (persistentId: string) => string
}

export interface ApplyHooks {
  isCancelled?: () => boolean
  onProgress?: (progress: MusicFixProgress) => void
  log?: ApplyLog
}

type Ending = { detailKey: string; detailParams?: { error: string }; status?: 'warn' | 'error' }

// What happened to one field, in Music and then in the file.
function endingOf(o: MusicFixOutcome, index: number): Ending {
  const music = o.music[index]
  if (music === 'mismatch') return { detailKey: 'activity.reviewFixMusicMismatch', status: 'warn' }
  if (music === 'missing') return { detailKey: 'activity.reviewFixMusicMissing', status: 'warn' }
  if (music === 'failed') return { detailKey: 'activity.reviewFixMusicFailed', status: 'error' }
  if (o.written.includes(o.fixes[index].field))
    return {
      detailKey: o.backupId ? 'activity.reviewFixWrittenBackup' : 'activity.reviewFixWritten',
    }
  if (o.file === 'failed')
    return {
      detailKey: 'activity.reviewFixFileFailed',
      detailParams: { error: o.error ?? '' },
      status: 'error',
    }
  if (o.file === 'missing') return { detailKey: 'activity.reviewFixNoFile', status: 'warn' }
  return { detailKey: 'activity.reviewFixFileDiffers', status: 'warn' }
}

async function loggedTrack(
  work: Promise<MusicFixOutcome>,
  fixes: MusicFieldFix[],
  log: ApplyLog,
  runSize: number,
): Promise<MusicFixOutcome> {
  const title = log.titleOf(fixes[0].persistentId)
  await Promise.all(
    fixes.map((f, i) =>
      log.track('applemusic', `activity.reviewFix.${f.field}`, () => work, {
        labelParams: { title },
        group: log.group,
        groupLabelKey: 'activity.reviewRun',
        groupLabelParams: { count: runSize },
        summary: (o) => endingOf(o, i),
      }),
    ),
  )
  return work
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e))

// Music is the guard: a field only reaches the file when Music still held the value the
// review read, so a track edited meanwhile is never overwritten on disk.
async function applyTrack(
  persistentId: string,
  fixes: MusicFieldFix[],
  deps: ApplyDeps,
): Promise<MusicFixOutcome> {
  const music: MusicFieldOutcome[] = []
  for (const f of fixes)
    music.push(
      await deps.setField(persistentId, f.field, f.from, f.to).catch(() => 'failed' as const),
    )
  const accepted = fixes.filter((_, i) => music[i] === 'set')
  if (accepted.length === 0) return { persistentId, fixes, music, file: 'skipped', written: [] }
  const path = await deps.locate(persistentId).catch(() => '')
  if (!path || !(await deps.exists(path)))
    return { persistentId, fixes, music, file: 'missing', path: path || undefined, written: [] }
  try {
    const { outcomes, backup } = await deps.rewrite(
      path,
      accepted.map(({ field, from, to }) => ({ field, from, to })),
    )
    const file = outcomes.includes('written') ? 'written' : 'unchanged'
    const written = accepted.filter((_, i) => outcomes[i] === 'written').map((f) => f.field)
    return { persistentId, path, fixes, music, file, written, backupId: backup?.id }
  } catch (e) {
    return { persistentId, path, fixes, music, file: 'failed', written: [], error: message(e) }
  }
}

export async function applyMusicFixes(
  fixes: MusicFieldFix[],
  deps: ApplyDeps,
  { isCancelled = () => false, onProgress, log }: ApplyHooks = {},
): Promise<MusicFixOutcome[]> {
  const byTrack = new Map<string, MusicFieldFix[]>()
  for (const f of fixes) byTrack.set(f.persistentId, [...(byTrack.get(f.persistentId) ?? []), f])
  const outcomes: MusicFixOutcome[] = []
  // Progress is a courtesy: a dead window must not lose the outcomes of tracks already written.
  const report = (current: number) => {
    try {
      onProgress?.({ done: outcomes.length, total: byTrack.size, current })
    } catch {}
  }
  for (const [persistentId, trackFixes] of byTrack) {
    if (isCancelled()) break
    report(outcomes.length + 1)
    const work = applyTrack(persistentId, trackFixes, deps)
    outcomes.push(await (log ? loggedTrack(work, trackFixes, log, byTrack.size) : work))
    report(outcomes.length)
  }
  return outcomes
}
