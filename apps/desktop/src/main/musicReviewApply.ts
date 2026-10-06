import type {
  MusicFieldFix,
  MusicFieldOutcome,
  MusicFixOutcome,
  MusicReviewField,
  TrashEntry,
} from '../shared/types'
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

export interface ApplyHooks {
  isCancelled?: () => boolean
  onProgress?: (done: number, total: number) => void
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
  { isCancelled = () => false, onProgress }: ApplyHooks = {},
): Promise<MusicFixOutcome[]> {
  const byTrack = new Map<string, MusicFieldFix[]>()
  for (const f of fixes) byTrack.set(f.persistentId, [...(byTrack.get(f.persistentId) ?? []), f])
  const outcomes: MusicFixOutcome[] = []
  for (const [persistentId, trackFixes] of byTrack) {
    if (isCancelled()) break
    outcomes.push(await applyTrack(persistentId, trackFixes, deps))
    // Progress is a courtesy: a dead window must not lose the outcomes of tracks already written.
    try {
      onProgress?.(outcomes.length, byTrack.size)
    } catch {}
  }
  return outcomes
}
