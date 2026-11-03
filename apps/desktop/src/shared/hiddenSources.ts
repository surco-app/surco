import { RAIL_PROGRAMS } from './djProgram'
import type { PlaylistSource } from './types'

const PLAYLIST_SOURCES: readonly PlaylistSource[] = ['appleMusic', ...RAIL_PROGRAMS]

export function normalizeHiddenSources(value: unknown): PlaylistSource[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((v): v is PlaylistSource => PLAYLIST_SOURCES.includes(v)))]
}
