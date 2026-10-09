import type {
  ListFixRequest,
  MusicFieldOutcome,
  MusicFixProgress,
  MusicReviewField,
  ReviewFix,
  ReviewOutcome,
  TrashEntry,
} from '../shared/types'
import type { MusicSetResult } from './applemusic'
import { type FieldEnding, logFieldRows, type RunLog } from './musicReviewLog'
import type { FieldWrite, TagFieldChange } from './tagFieldSet'

export interface ListApplyDeps {
  allowed: (path: string) => boolean
  exists: (path: string) => Promise<boolean>
  rewrite: (
    file: string,
    changes: TagFieldChange[],
  ) => Promise<{ outcomes: FieldWrite[]; backup?: TrashEntry }>
  setMusicField?: (
    persistentId: string,
    field: MusicReviewField,
    from: string,
    to: string,
    location: string,
  ) => Promise<MusicSetResult>
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e))

// What happened to one field, in the file and then in Music.
function endingOf(o: ReviewOutcome, index: number): FieldEnding {
  if (o.file === 'failed')
    return {
      detailKey: 'activity.listReviewFixFileFailed',
      detailParams: { error: o.error ?? '' },
      status: 'error',
    }
  if (o.file === 'missing') return { detailKey: 'activity.listReviewFixNoFile', status: 'warn' }
  if (!o.written.includes(o.fixes[index].field))
    return { detailKey: 'activity.listReviewFixFileDiffers', status: 'warn' }
  const music = o.music[index]
  if (music === 'mismatch')
    return { detailKey: 'activity.listReviewFixMusicMismatch', status: 'warn' }
  if (music === 'missing')
    return { detailKey: 'activity.listReviewFixMusicMissing', status: 'warn' }
  if (music === 'failed') return { detailKey: 'activity.listReviewFixMusicFailed', status: 'error' }
  if (music === 'set')
    return {
      detailKey: o.backupId ? 'activity.reviewFixWrittenBackup' : 'activity.reviewFixWritten',
    }
  return {
    detailKey: o.backupId ? 'activity.listReviewFixWrittenBackup' : 'activity.listReviewFixWritten',
  }
}

// The file is the guard here, the reverse of the Music review: a field reaches Music only
// once it reached the file, and Music is asked with the value the file held and the file's
// path, so an entry that says something else or sits on another file is left as it is.
async function applyFile(
  path: string,
  fixes: ReviewFix[],
  musicId: string | undefined,
  deps: ListApplyDeps,
): Promise<ReviewOutcome> {
  const base = { id: path, path, fixes, ...(musicId ? { musicId } : {}) }
  const none = fixes.map(() => 'none' as const)
  if (!deps.allowed(path))
    return { ...base, music: none, file: 'failed', written: [], error: 'pathNotAllowed' }
  if (!(await deps.exists(path))) return { ...base, music: none, file: 'missing', written: [] }
  let result: { outcomes: FieldWrite[]; backup?: TrashEntry }
  try {
    result = await deps.rewrite(
      path,
      fixes.map(({ field, from, to }) => ({ field, from, to })),
    )
  } catch (e) {
    return { ...base, music: none, file: 'failed', written: [], error: message(e) }
  }
  const music: (MusicFieldOutcome | 'none')[] = []
  for (const [i, f] of fixes.entries())
    music.push(
      musicId && deps.setMusicField && result.outcomes[i] === 'written'
        ? await deps
            .setMusicField(musicId, f.field, f.from, f.to, path)
            .catch(() => 'failed' as const)
        : 'none',
    )
  const written = fixes.filter((_, i) => result.outcomes[i] === 'written').map((f) => f.field)
  return {
    ...base,
    music,
    file: written.length ? 'written' : 'unchanged',
    written,
    ...(result.backup ? { backupId: result.backup.id } : {}),
  }
}

export async function applyListFixes(
  { fixes, music }: Pick<ListFixRequest, 'fixes' | 'music'>,
  deps: ListApplyDeps,
  {
    isCancelled = () => false,
    onProgress,
    log,
  }: { isCancelled?: () => boolean; onProgress?: (p: MusicFixProgress) => void; log?: RunLog } = {},
): Promise<ReviewOutcome[]> {
  const byFile = new Map<string, ReviewFix[]>()
  for (const f of fixes) byFile.set(f.id, [...(byFile.get(f.id) ?? []), f])
  const outcomes: ReviewOutcome[] = []
  // Progress is a courtesy: a dead window must not lose the outcomes of files already written.
  const report = (current: number) => {
    try {
      onProgress?.({ done: outcomes.length, total: byFile.size, current })
    } catch {}
  }
  for (const [path, fileFixes] of byFile) {
    if (isCancelled()) break
    report(outcomes.length + 1)
    const work = applyFile(path, fileFixes, music[path], deps)
    outcomes.push(
      await (log
        ? logFieldRows(
            work,
            { id: path, fields: fileFixes.map((f) => f.field) },
            log,
            { labelKey: 'activity.listReviewRun', count: byFile.size },
            endingOf,
          )
        : work),
    )
    report(outcomes.length)
  }
  return outcomes
}
