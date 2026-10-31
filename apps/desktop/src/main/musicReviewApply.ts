import type {
  MusicFieldFix,
  MusicFieldOutcome,
  MusicFixOutcome,
  MusicFixProgress,
  MusicReviewField,
} from '../shared/types'
import type { MusicSetResult } from './applemusic'
import type { PreparedRewrite } from './musicFieldWrite'
import { type FieldEnding, logFieldRows, type RunLog } from './musicReviewLog'

export interface ApplyDeps {
  setField: (
    persistentId: string,
    field: MusicReviewField,
    from: string,
    to: string,
  ) => Promise<MusicSetResult>
  locate: (persistentId: string) => Promise<string>
  exists: (path: string) => Promise<boolean>
  prepare: (file: string) => Promise<PreparedRewrite>
}

export interface ApplyHooks {
  isCancelled?: () => boolean
  onProgress?: (progress: MusicFixProgress) => void
  log?: RunLog
}

// What happened to one field, in Music and then in the file.
function endingOf(o: MusicFixOutcome, index: number): FieldEnding {
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
      detailKey:
        o.music.length === 0 ? 'activity.reviewFixUntouched' : 'activity.reviewFixFileFailed',
      detailParams: { error: o.error ?? '' },
      status: 'error',
    }
  if (o.file === 'missing') return { detailKey: 'activity.reviewFixNoFile', status: 'warn' }
  return { detailKey: 'activity.reviewFixFileDiffers', status: 'warn' }
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e))

// Music is the guard: a field only reaches the file when Music still held the value the
// review read, so a track edited meanwhile is never overwritten on disk. The file is
// copied and backed up before Music is asked, since Music rewrites it on the spot.
async function applyTrack(
  persistentId: string,
  fixes: MusicFieldFix[],
  deps: ApplyDeps,
): Promise<MusicFixOutcome> {
  let path = ''
  let prepared: PreparedRewrite | undefined
  try {
    path = await deps.locate(persistentId)
    if (path && (await deps.exists(path))) prepared = await deps.prepare(path)
  } catch (e) {
    return {
      persistentId,
      path: path || undefined,
      fixes,
      music: [],
      file: 'failed',
      written: [],
      error: message(e),
    }
  }
  const music: MusicFieldOutcome[] = []
  for (const f of fixes)
    music.push(
      await deps.setField(persistentId, f.field, f.from, f.to).catch(() => 'failed' as const),
    )
  const accepted = fixes.filter((_, i) => music[i] === 'set')
  if (accepted.length === 0) {
    // Music refused every field, so it wrote nothing; one that did not answer may have.
    if (!music.includes('failed')) {
      await prepared?.abandon()
      return { persistentId, fixes, music, file: 'skipped', written: [] }
    }
    const kept = await prepared?.keep()
    return { persistentId, fixes, music, file: 'skipped', written: [], backupId: kept?.id }
  }
  if (!prepared)
    return { persistentId, fixes, music, file: 'missing', path: path || undefined, written: [] }
  try {
    const { outcomes, backup } = await prepared.write(
      accepted.map(({ field, from, to }) => ({ field, from, to })),
    )
    const file = outcomes.includes('written') ? 'written' : 'unchanged'
    const written = accepted.filter((_, i) => outcomes[i] === 'written').map((f) => f.field)
    return { persistentId, path, fixes, music, file, written, backupId: backup?.id }
  } catch (e) {
    return {
      persistentId,
      path,
      fixes,
      music,
      file: 'failed',
      written: [],
      error: message(e),
      backupId: prepared.backup()?.id,
    }
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
    outcomes.push(
      await (log
        ? logFieldRows(
            work,
            { id: persistentId, fields: trackFixes.map((f) => f.field) },
            log,
            { labelKey: 'activity.reviewRun', count: byTrack.size },
            endingOf,
          )
        : work),
    )
    report(outcomes.length)
  }
  return outcomes
}
