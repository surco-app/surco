import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { AppleMusicPlaylist, AppleMusicPlaylistTracks } from '../shared/types'

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

// Each library track's file, by persistent ID, with the modified date it had when it was
// resolved: resolving a location asks the NAS file by file (64 s for 171 tracks on a cold
// NAS), and the file stays put until Music modifies the track.
export type TrackLocations = Record<string, { path: string; modified: string }>

const locationsFile = (): string =>
  join(app.getPath('userData'), 'apple-music-playlists', 'locations.json')

export function loadTrackLocations(): TrackLocations {
  try {
    const raw: unknown = JSON.parse(readFileSync(locationsFile(), 'utf-8'))
    return isRecord(raw) ? (raw as TrackLocations) : {}
  } catch {
    return {}
  }
}

export function saveTrackLocations(locations: TrackLocations): void {
  try {
    const file = locationsFile()
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(`${file}.tmp`, JSON.stringify(locations))
    renameSync(`${file}.tmp`, file)
  } catch {
    return
  }
}

// The last list of playlists Music gave, so the Music tab shows its tree at once while Music
// lists them again (1.8 s, measured 01/11).
const listFile = (): string => join(app.getPath('userData'), 'apple-music-playlists', 'list.json')

export function savePlaylistListCache(lists: AppleMusicPlaylist[]): void {
  try {
    const file = listFile()
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(`${file}.tmp`, JSON.stringify(lists))
    renameSync(`${file}.tmp`, file)
  } catch {
    return
  }
}

export function loadPlaylistListCache(): AppleMusicPlaylist[] | null {
  try {
    const raw: unknown = JSON.parse(readFileSync(listFile(), 'utf-8'))
    if (!Array.isArray(raw)) return null
    const lists = raw.filter(
      (l): l is AppleMusicPlaylist =>
        isRecord(l) &&
        typeof l.name === 'string' &&
        typeof l.count === 'number' &&
        typeof l.persistentId === 'string',
    )
    return lists.length === raw.length ? lists : null
  } catch {
    return null
  }
}

// Which tracks each playlist holds, by persistent ID, as the library database last gave them.
const membersFile = (): string =>
  join(app.getPath('userData'), 'apple-music-playlists', 'members.json')

export function savePlaylistMembers(members: Record<string, string[]>): void {
  try {
    const file = membersFile()
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(`${file}.tmp`, JSON.stringify(members))
    renameSync(`${file}.tmp`, file)
  } catch {
    return
  }
}

function loadPlaylistMembers(persistentId: string): string[] | null {
  try {
    const raw: unknown = JSON.parse(readFileSync(membersFile(), 'utf-8'))
    const ids = isRecord(raw) ? raw[persistentId] : null
    return Array.isArray(ids) && ids.every((id) => typeof id === 'string') ? ids : null
  } catch {
    return null
  }
}

// A playlist never read whole, put together from the tracks it holds and the library's own
// last read, so it shows at once while Music reads it.
export function derivedPlaylistCache(persistentId: string): AppleMusicPlaylistTracks | null {
  const members = loadPlaylistMembers(persistentId)
  const libraryId = loadPlaylistListCache()?.find((l) => l.library)?.persistentId
  const library = libraryId ? loadPlaylistCache(libraryId) : null
  if (!members || !library) return null
  const pathOf = new Map(Object.entries(library.persistentIds).map(([path, id]) => [id, path]))
  const tracks: AppleMusicPlaylistTracks = {
    paths: [],
    persistentIds: {},
    meta: {},
    missing: 0,
    total: members.length,
  }
  for (const id of members) {
    const path = pathOf.get(id)
    if (!path) {
      tracks.missing += 1
      continue
    }
    if (path in tracks.persistentIds) continue
    tracks.paths.push(path)
    tracks.persistentIds[path] = id
    const meta = library.meta[path]
    if (meta) tracks.meta[path] = meta
  }
  return tracks
}
