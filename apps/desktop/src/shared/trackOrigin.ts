import { type DjProgram, isWritable, type LibraryProgram, type ReadOnlyProgram } from './djProgram'
import type { ErrorKey } from './errorKeys'
import type { RekordboxPlaylistTarget } from './types'

export interface TrackOrigin {
  programs?: DjProgram[]
  playlists?: Partial<
    Record<LibraryProgram, { targets?: RekordboxPlaylistTarget[]; base?: string[] }>
  >
}

// A track a DJ program or Music lists belongs to a collection the DJ organises: opened to
// fix its tags, not to convert it. Its own format is the default, while a loose file takes
// the Settings one.
export function keepsOwnFormat(t: TrackOrigin & { fromAppleMusic?: boolean }): boolean {
  return !!t.fromAppleMusic || (t.programs?.length ?? 0) > 0
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

export const READ_ONLY_BLOCKED: Record<ReadOnlyProgram, ErrorKey> = {
  serato: 'seratoBlocked',
}

export function withPrograms(t: TrackOrigin, ps: readonly DjProgram[]): DjProgram[] {
  return [...new Set([...(t.programs ?? []), ...ps])]
}
