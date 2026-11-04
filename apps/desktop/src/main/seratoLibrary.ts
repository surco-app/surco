import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, posix } from 'node:path'
import { ALL_TRACKS_ID } from '../shared/allTracks'
import { RECENTLY_ADDED_ID } from '../shared/recentlyAdded'
import type { AppleMusicTrackMeta, SourceNode, SourcePlaylistEntry } from '../shared/types'
import {
  crateTree,
  parseSeratoCrate,
  parseSeratoDatabase,
  type SeratoCrateNode,
  type SeratoTrack,
} from './seratoDatabase'
import { recentSince } from './traktorPlaylists'

export interface SeratoLibraryRoot {
  dir: string
  root: string
}

export type SeratoLibraryTrack = SeratoTrack & { file: string }

export interface SeratoLibrary {
  tracks: SeratoLibraryTrack[]
  crates: Map<string, string[]>
}

export function seratoLibraryRoots(home: string, volumes: string[]): SeratoLibraryRoot[] {
  return [
    { dir: join(home, 'Music', '_Serato_'), root: '/' },
    ...volumes.map((volume) => ({ dir: join(volume, '_Serato_'), root: volume })),
  ].filter((r) => existsSync(r.dir))
}

const parsed = new Map<string, { mtimeMs: number; size: number; value: unknown }>()

function parsedFile<T>(file: string, parse: (bytes: Buffer) => T): T {
  const { mtimeMs, size } = statSync(file)
  const hit = parsed.get(file)
  if (hit && hit.mtimeMs === mtimeMs && hit.size === size) return hit.value as T
  const value = parse(readFileSync(file))
  parsed.set(file, { mtimeMs, size, value })
  return value
}

function readRoot({ dir, root }: SeratoLibraryRoot): SeratoLibrary {
  const fileOf = (path: string) => posix.join(root, path)
  const tracks = parsedFile(join(dir, 'database V2'), parseSeratoDatabase).map((t) => ({
    ...t,
    file: fileOf(t.path),
  }))
  const subcrates = join(dir, 'Subcrates')
  const names = existsSync(subcrates) ? readdirSync(subcrates) : []
  const crates = new Map<string, string[]>()
  for (const name of names.filter((n) => n.endsWith('.crate'))) {
    const files = readCrate(join(subcrates, name))
    if (files) crates.set(name.slice(0, -'.crate'.length), files.map(fileOf))
  }
  return { tracks, crates }
}

function readCrate(file: string): string[] | null {
  try {
    return parsedFile(file, parseSeratoCrate)
  } catch {
    return null
  }
}

export function readSeratoLibrary(roots: SeratoLibraryRoot[]): SeratoLibrary {
  const library: SeratoLibrary = { tracks: [], crates: new Map() }
  for (const root of roots) {
    let part: SeratoLibrary
    try {
      part = readRoot(root)
    } catch {
      continue
    }
    library.tracks.push(...part.tracks)
    for (const [id, files] of part.crates)
      library.crates.set(id, [...(library.crates.get(id) ?? []), ...files])
  }
  return library
}

function toSource(nodes: SeratoCrateNode[], crates: Map<string, string[]>): SourceNode[] {
  return nodes.map((n): SourceNode => {
    if (n.children.length === 0)
      return { id: n.id, name: n.name, kind: 'playlist', count: crates.get(n.id)?.length ?? 0 }
    const children = toSource(n.children, crates)
    return { id: n.id, name: n.name, kind: 'folder', count: children.length, children }
  })
}

export function seratoTree(library: SeratoLibrary): SourceNode[] {
  return toSource(crateTree([...library.crates.keys()].map((id) => `${id}.crate`)), library.crates)
}

function newestFirst(tracks: SeratoLibraryTrack[]): SeratoLibraryTrack[] {
  return tracks
    .map((t, order) => ({ t, order }))
    .sort((a, b) => (b.t.addedAt ?? 0) - (a.t.addedAt ?? 0) || b.order - a.order)
    .map(({ t }) => t)
}

function recentTracks(library: SeratoLibrary, now: Date): SeratoLibraryTrack[] {
  const since = recentSince(now)
  return newestFirst(library.tracks.filter((t) => t.addedAt !== null && t.addedAt * 1000 >= since))
}

export function seratoRecentCount(library: SeratoLibrary, now: Date = new Date()): number {
  return recentTracks(library, now).length
}

export function seratoTrackCount(library: SeratoLibrary): number {
  return library.tracks.length
}

function metaOf(track: SeratoLibraryTrack | undefined): AppleMusicTrackMeta {
  const meta: AppleMusicTrackMeta = {}
  const bpm = Number(track?.bpm)
  if (bpm > 0) meta.bpm = String(Number(bpm.toFixed(2)))
  if (track?.key) meta.key = track.key
  return meta
}

function entryOf(file: string, track?: SeratoLibraryTrack): SourcePlaylistEntry {
  return { path: file, separator: false, meta: metaOf(track), contentId: `serato:${file}` }
}

export function seratoPlaylist(
  library: SeratoLibrary,
  id: string,
  now: Date = new Date(),
): SourcePlaylistEntry[] {
  if (id === RECENTLY_ADDED_ID) return recentTracks(library, now).map((t) => entryOf(t.file, t))
  if (id === ALL_TRACKS_ID) return newestFirst(library.tracks).map((t) => entryOf(t.file, t))
  const byFile = new Map(library.tracks.map((t) => [t.file.normalize('NFC'), t]))
  return (library.crates.get(id) ?? []).map((file) =>
    entryOf(file, byFile.get(file.normalize('NFC'))),
  )
}

export function seratoMembership(
  library: SeratoLibrary,
  paths: string[],
): Record<string, string[]> {
  const known = new Set(library.tracks.map((t) => t.file.normalize('NFC')))
  const crates = [...library.crates].map(
    ([id, files]) => [id, new Set(files.map((f) => f.normalize('NFC')))] as const,
  )
  const out: Record<string, string[]> = {}
  for (const path of paths) {
    const file = path.normalize('NFC')
    if (!known.has(file)) continue
    out[path] = crates
      .filter(([, files]) => files.has(file))
      .map(([id]) => id)
      .sort()
  }
  return out
}
