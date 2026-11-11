import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { ALL_TRACKS_ID } from '../shared/allTracks'
import { RECENTLY_ADDED_ID } from '../shared/recentlyAdded'
import type {
  AppleMusicTrackMeta,
  CollectionTrack,
  SourceNode,
  SourcePlaylistEntry,
} from '../shared/types'
import { recentSince } from './traktorPlaylists'
import { parseVirtualdjDatabase, type VirtualdjSong } from './virtualdjDatabase'
import { readVirtualdjLists, type VirtualdjNode } from './virtualdjLists'

export interface VirtualdjLibrary {
  songs: VirtualdjSong[]
  lists: VirtualdjNode[]
}

const parsed = new Map<string, { mtimeMs: number; size: number; songs: VirtualdjSong[] }>()

function readSongs(file: string): VirtualdjSong[] {
  let stat: { mtimeMs: number; size: number }
  try {
    stat = statSync(file)
  } catch {
    return []
  }
  const hit = parsed.get(file)
  if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) return hit.songs
  const songs = parseVirtualdjDatabase(readFileSync(file, 'utf8'))
  parsed.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, songs })
  return songs
}

export function readVirtualdjSongs(dir: string): VirtualdjSong[] {
  return readSongs(join(dir, 'database.xml'))
}

export function readVirtualdjLibrary(dir: string): VirtualdjLibrary {
  return {
    songs: readVirtualdjSongs(dir),
    lists: readVirtualdjLists(join(dir, 'MyLists')),
  }
}

const nfc = (path: string) => path.normalize('NFC')

function playlists(nodes: VirtualdjNode[]): VirtualdjNode[] {
  return nodes.flatMap((n) => (n.kind === 'playlist' ? [n] : playlists(n.children ?? [])))
}

function toSource(nodes: VirtualdjNode[]): SourceNode[] {
  return nodes.map((n): SourceNode => {
    if (n.kind === 'playlist')
      return { id: n.id, name: n.name, kind: 'playlist', count: n.paths.length }
    const children = toSource(n.children ?? [])
    return { id: n.id, name: n.name, kind: 'folder', count: children.length, children }
  })
}

export function virtualdjTree(library: VirtualdjLibrary): SourceNode[] {
  return toSource(library.lists)
}

function newestFirst(songs: VirtualdjSong[]): VirtualdjSong[] {
  return songs
    .map((s, order) => ({ s, order }))
    .sort((a, b) => (b.s.firstSeen ?? 0) - (a.s.firstSeen ?? 0) || b.order - a.order)
    .map(({ s }) => s)
}

function recentSongs(library: VirtualdjLibrary, now: Date): VirtualdjSong[] {
  const since = recentSince(now)
  return newestFirst(
    library.songs.filter((s) => s.firstSeen !== null && s.firstSeen * 1000 >= since),
  )
}

export function virtualdjRecentCount(library: VirtualdjLibrary, now: Date = new Date()): number {
  return recentSongs(library, now).length
}

export function virtualdjTrackCount(library: VirtualdjLibrary): number {
  return library.songs.length
}

export function virtualdjCollection(library: VirtualdjLibrary): CollectionTrack[] {
  return newestFirst(library.songs).map((s) => ({
    contentId: `virtualdj:${s.path}`,
    path: s.path,
    title: s.title,
    artist: s.artist,
  }))
}

function metaOf(song: VirtualdjSong | undefined): AppleMusicTrackMeta {
  const meta: AppleMusicTrackMeta = {}
  if (song?.secondsPerBeat) meta.bpm = String(Number((60 / song.secondsPerBeat).toFixed(2)))
  if (song?.key) meta.key = song.key
  return meta
}

function entryOf(path: string, song?: VirtualdjSong): SourcePlaylistEntry {
  return {
    path,
    separator: false,
    meta: metaOf(song),
    contentId: `virtualdj:${song?.path ?? path}`,
  }
}

export function virtualdjPlaylist(
  library: VirtualdjLibrary,
  id: string,
  now: Date = new Date(),
): SourcePlaylistEntry[] {
  if (id === RECENTLY_ADDED_ID) return recentSongs(library, now).map((s) => entryOf(s.path, s))
  if (id === ALL_TRACKS_ID) return newestFirst(library.songs).map((s) => entryOf(s.path, s))
  const list = playlists(library.lists).find((n) => n.id === id)
  if (!list) return []
  const byPath = new Map(library.songs.map((s) => [nfc(s.path), s]))
  return list.paths.map((path) => entryOf(path, byPath.get(nfc(path))))
}

export function virtualdjMembership(
  library: VirtualdjLibrary,
  paths: string[],
): Record<string, string[]> {
  const lists = playlists(library.lists).map((n) => [n.id, new Set(n.paths.map(nfc))] as const)
  const known = new Set([
    ...library.songs.map((s) => nfc(s.path)),
    ...lists.flatMap(([, files]) => [...files]),
  ])
  const out: Record<string, string[]> = {}
  for (const path of paths) {
    const file = nfc(path)
    if (!known.has(file)) continue
    out[path] = lists.filter(([, files]) => files.has(file)).map(([id]) => id)
  }
  return out
}
