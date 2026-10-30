import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { AppleMusicPlaylistTracks } from '../shared/types'

// The last whole read of each Music playlist, so opening one shows it at once with every
// count right while the database reads it again: measured on a NAS, the same 2,044-track
// read took 0.3 s one time and 14 s the next. Machine-local, like the library cache.
const PERSISTENT_ID = /^[0-9A-F]{16}$/

function cacheFile(persistentId: string): string {
  return join(app.getPath('userData'), 'apple-music-playlists', `${persistentId}.json`)
}

// Write-then-rename so a crash mid-write leaves the previous read. Only an optimization,
// so a failed write never fails the read it was keeping.
export function savePlaylistCache(persistentId: string, tracks: AppleMusicPlaylistTracks): void {
  if (!PERSISTENT_ID.test(persistentId)) return
  try {
    const file = cacheFile(persistentId)
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(`${file}.tmp`, JSON.stringify(tracks))
    renameSync(`${file}.tmp`, file)
  } catch {
    return
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function loadPlaylistCache(persistentId: string): AppleMusicPlaylistTracks | null {
  if (!PERSISTENT_ID.test(persistentId)) return null
  try {
    const raw: unknown = JSON.parse(readFileSync(cacheFile(persistentId), 'utf-8'))
    if (!isRecord(raw)) return null
    const { paths, persistentIds, meta, missing, total } = raw
    if (!Array.isArray(paths) || !paths.every((p) => typeof p === 'string')) return null
    if (!isRecord(persistentIds) || !isRecord(meta) || typeof missing !== 'number') return null
    return {
      paths,
      persistentIds: persistentIds as AppleMusicPlaylistTracks['persistentIds'],
      meta: meta as AppleMusicPlaylistTracks['meta'],
      missing,
      ...(typeof total === 'number' ? { total } : {}),
    }
  } catch {
    return null
  }
}
