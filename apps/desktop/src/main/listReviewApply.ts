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
  { fixes, music }: ListFixRequest,
  deps: ListApplyDeps,
  {
    isCancelled = () => false,
    onProgress,
  }: { isCancelled?: () => boolean; onProgress?: (p: MusicFixProgress) => void } = {},
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
    outcomes.push(await applyFile(path, fileFixes, music[path], deps))
    report(outcomes.length)
  }
  return outcomes
}
