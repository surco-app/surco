import { resolve } from 'node:path'
import { chainOrder, type EngineDb, readEngineTree } from './enginePlaylists'
import { selectedPlaylists } from './usbExportSource'

export interface EngineUsbTrack {
  id: number
  path: string | null
  title: string
  artist: string
  artHash: unknown
}

export interface EngineUsbPlaylist {
  id: string
  name: string
  folders: string[]
  trackIds: number[]
}

export interface EngineUsbSelection {
  playlists: EngineUsbPlaylist[]
  tracks: EngineUsbTrack[]
}

interface Entry {
  id: number
  next: number
  trackId: number
}

interface TrackRow {
  id: number
  path: string | null
  title: string | null
  artist: string | null
  artHash: unknown
}

export function readEngineUsbSelection(
  db: EngineDb,
  libraryDir: string,
  ids: string[],
): EngineUsbSelection {
  const picked = selectedPlaylists(readEngineTree(db), new Set(ids))
  const entries = db.prepare(
    `SELECT e.id, e.nextEntityId AS next, e.trackId
       FROM PlaylistEntity e JOIN Track t ON t.id = e.trackId WHERE e.listId = ?`,
  )
  const track = db.prepare(
    `SELECT t.id, t.path, t.title, t.artist, a.hash AS artHash
       FROM Track t LEFT JOIN AlbumArt a ON a.id = t.albumArtId WHERE t.id = ?`,
  )
  const tracks = new Map<number, EngineUsbTrack>()
  const playlists = picked.map(({ node, folders }) => {
    const trackIds = chainOrder(entries.all(Number(node.id)) as Entry[]).map((e) => e.trackId)
    for (const id of trackIds) {
      if (tracks.has(id)) continue
      const r = track.get(id) as TrackRow
      tracks.set(id, {
        id,
        path: r.path ? resolve(libraryDir, r.path) : null,
        title: r.title?.trim() ?? '',
        artist: r.artist?.trim() ?? '',
        artHash: r.artHash,
      })
    }
    return { id: node.id, name: node.name, folders, trackIds }
  })
  return { playlists, tracks: [...tracks.values()] }
}

export function artworkFileName(hash: unknown): string | null {
  return Buffer.isBuffer(hash) ? hash.toString('base64url') : null
}
