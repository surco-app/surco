import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, posix, resolve } from 'node:path'
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
import { readVirtualdjLists, type VirtualdjNode, virtualdjLinkId } from './virtualdjLists'

export interface VirtualdjLibrary {
  songs: VirtualdjSong[]
  lists: VirtualdjNode[]
}

export interface VirtualdjRoot {
  dir: string
  root: string
  home?: boolean
}

export const isVirtualdjHome = (root: VirtualdjRoot): boolean =>
  root.root === '/' || root.home === true

export function virtualdjLibraryRoots(dir: string, volumesRoot: string): VirtualdjRoot[] {
  let volumes: string[] = []
  try {
    volumes = readdirSync(volumesRoot).map((name) => join(volumesRoot, name))
  } catch {}
  const drives = volumes.map((volume) => ({ dir: join(volume, 'VirtualDJ'), root: volume }))
  const homeDrive = drives.find((d) => resolve(d.dir) === resolve(dir))
  return [
    homeDrive ? { ...homeDrive, home: true } : { dir, root: '/' },
    ...drives.filter((d) => d !== homeDrive),
  ].filter((r) => existsSync(join(r.dir, 'database.xml')))
}

const DRIVE = /^[A-Za-z]:\//

export function virtualdjPathOf(root: VirtualdjRoot, filePath: string): string {
  return root.root !== '/' && DRIVE.test(filePath)
    ? posix.join(root.root, filePath.slice(3))
    : filePath
}

export function virtualdjStoredPath(root: VirtualdjRoot, path: string, xml: string): string {
  if (root.root === '/') return path
  const letter = xml.match(/FilePath="([A-Za-z]):\//)?.[1] ?? 'D'
  return `${letter}:/${posix.relative(root.root, path)}`
}

const parsed = new Map<
  string,
  { mtimeMs: number; size: number; root: string; songs: VirtualdjSong[] }
>()

function readSongs(root: VirtualdjRoot): VirtualdjSong[] {
  const file = join(root.dir, 'database.xml')
  let stat: { mtimeMs: number; size: number }
  try {
    stat = statSync(file)
  } catch {
    return []
  }
  const hit = parsed.get(file)
  if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size && hit.root === root.root)
    return hit.songs
  const songs = parseVirtualdjDatabase(readFileSync(file, 'utf8')).map((s) => ({
    ...s,
    path: virtualdjPathOf(root, s.path),
  }))
  parsed.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, root: root.root, songs })
  return songs
}

let combined: { parts: VirtualdjSong[][]; songs: VirtualdjSong[] } | undefined

export function readVirtualdjSongs(roots: VirtualdjRoot[]): VirtualdjSong[] {
  const parts = roots.map(readSongs)
  if (
    !combined ||
    combined.parts.length !== parts.length ||
    combined.parts.some((p, i) => p !== parts[i])
  )
    combined = { parts, songs: parts.flat() }
  return combined.songs
}

export function readVirtualdjLibrary(roots: VirtualdjRoot[]): VirtualdjLibrary {
  const home = roots.find(isVirtualdjHome)
  return {
    songs: readVirtualdjSongs(roots),
    lists: home ? readVirtualdjLists(join(home.dir, 'MyLists')) : [],
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
  return list.paths.map((path, i) => ({
    ...entryOf(path, byPath.get(nfc(path))),
    linkId: virtualdjLinkId(i, path),
  }))
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
