import { type DjProgram, isWritable, type LibraryProgram } from './djProgram'
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

export function withPrograms(t: TrackOrigin, ps: readonly DjProgram[]): DjProgram[] {
  return [...new Set([...(t.programs ?? []), ...ps])]
}
