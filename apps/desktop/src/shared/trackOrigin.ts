import { type DjProgram, isWritable, type LibraryProgram, type ReadOnlyProgram } from './djProgram'
import type { RekordboxPlaylistTarget } from './types'

export interface TrackOrigin {
  programs?: DjProgram[]
  playlists?: Partial<
    Record<LibraryProgram, { targets?: RekordboxPlaylistTarget[]; base?: string[] }>
  >
}

export function isFrom(t: TrackOrigin, p: DjProgram): boolean {
  return t.programs?.includes(p) ?? false
}

export function fromReadOnlyProgram(t: TrackOrigin): boolean {
  return t.programs?.some((p) => !isWritable(p)) ?? false
}

export function readOnlyProgramsOf(t: TrackOrigin): ReadOnlyProgram[] {
  return (t.programs ?? []).filter((p): p is ReadOnlyProgram => !isWritable(p))
}

export const READ_ONLY_BLOCKED: Record<ReadOnlyProgram, 'seratoBlocked' | 'virtualdjBlocked'> = {
  serato: 'seratoBlocked',
  virtualdj: 'virtualdjBlocked',
}

export function withPrograms(t: TrackOrigin, ps: readonly DjProgram[]): DjProgram[] {
  return [...new Set([...(t.programs ?? []), ...ps])]
}
