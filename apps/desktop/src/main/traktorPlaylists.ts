import { ALL_TRACKS_ID } from '../shared/allTracks'
import { HOT_KINDS } from '../shared/cueRules'
import { RECENTLY_ADDED_ID } from '../shared/recentlyAdded'
import {
  TRAKTOR_CUE_HEX,
  TRAKTOR_HISTORY,
  TRAKTOR_HOT_OFFSET,
  traktorContentId,
} from '../shared/traktorContent'
import type { AppleMusicTrackMeta, RowCue, SourceNode, SourcePlaylistEntry } from '../shared/types'
import { attr, findEntries } from './traktorNml'
import { rekordboxColorOf } from './traktorNmlCues'
import { type ModelNode, nodeById, parsePlaylists, rowLinkId } from './traktorPlaylistModel'

const GRID_TYPE = 4
const RECENT_DAYS = 30
const CUE_RE = /<CUE_V2\b[^>]*>/g

// Traktor colours a hot cue by its type (cue, fade in, fade out, load, loop) and writes a
// COLOR only for the few it paints itself, like the white AutoGrid cue.
export const TRAKTOR_TYPE_COLOR: Record<number, string> = {
  0: TRAKTOR_CUE_HEX,
  1: '#ff8c00',
  2: '#ff8c00',
  3: '#c3af04',
  4: '#ffffff',
  5: '#3ceb50',
}

// The collection the DJ pointed Settings at wins, because some keep theirs outside
// Documents (see traktorNmlPath.ts); otherwise the newest Traktor on the machine, which
// is how the tab knows Traktor is installed at all.
export function nmlPath(
  configured: string,
  detected: string[],
  exists: (path: string) => boolean,
): string {
  if (configured !== '' && exists(configured)) return configured
  return detected.find(exists) ?? ''
}

function toTree(nodes: ModelNode[]): SourceNode[] {
  return nodes.flatMap((n): SourceNode[] => {
    if (n.kind === 'smartlist') return []
    if (n.kind === 'playlist')
      return [{ id: n.id, name: n.name, kind: 'playlist', count: n.rows.length }]
    const children = toTree(n.children)
    return [{ id: n.id, name: n.name, kind: 'folder', count: children.length, children }]
  })
}

export function readTraktorTree(nml: string): SourceNode[] {
  return toTree(parsePlaylists(nml)?.root.children ?? [])
}

interface Track {
  key: string
  block: string
  imported: number
}

function importedAt(date: string): number {
  const [y, m, d] = date.split('/').map(Number)
  return y && m && d ? new Date(y, m - 1, d).getTime() : 0
}

function collection(nml: string): Track[] {
  return findEntries(nml)
    .filter((e) => e.file)
    .map((e) => {
      const block = nml.slice(e.start, e.end)
      const info = block.match(/<INFO\b[^>]*>/)?.[0] ?? ''
      return {
        key: `${e.volume}${e.dir}${e.file}`,
        block,
        imported: importedAt(attr(info, 'IMPORT_DATE')),
      }
    })
}

// Traktor stores a path as VOLUME + DIR ("/:Users/:dj/:") + FILE. A drive letter is
// Windows; the boot disk's own name (or none) is the root of macOS; any other volume is
// mounted under /Volumes.
export function traktorFileOf(block: string, bootVolume: string): string {
  const location = block.match(/<LOCATION\b[^>]*>/)?.[0] ?? ''
  const volume = attr(location, 'VOLUME')
  const folder = attr(location, 'DIR').replace(/\/:/g, '/')
  const path = `${folder}${attr(location, 'FILE')}`
  if (/^[A-Za-z]:$/.test(volume)) return `${volume}${path.replace(/\//g, '\\')}`
  return volume === '' || volume === bootVolume ? path : `/Volumes/${volume}${path}`
}

function metaOf(block: string): AppleMusicTrackMeta {
  const meta: AppleMusicTrackMeta = {}
  const bpm = Number(attr(block.match(/<TEMPO\b[^>]*>/)?.[0] ?? '', 'BPM'))
  if (bpm > 0) meta.bpm = String(Number(bpm.toFixed(2)))
  const ranking = Number(attr(block.match(/<INFO\b[^>]*>/)?.[0] ?? '', 'RANKING'))
  if (ranking > 0) meta.rating = Math.round((ranking * 100) / 255)
  return meta
}

function cuesOf(block: string): RowCue[] {
  return [...block.matchAll(CUE_RE)]
    .map(([cue]) => cue)
    .filter((cue) => Number(attr(cue, 'TYPE')) !== GRID_TYPE)
    .map((cue) => ({ cue, hotcue: Number(attr(cue, 'HOTCUE') || '-1') }))
    .filter(({ hotcue }) => hotcue !== 0)
    .map(({ cue, hotcue }) => {
      const kind = HOT_KINDS[hotcue - TRAKTOR_HOT_OFFSET] ?? 0
      const color = attr(cue, 'COLOR') || TRAKTOR_TYPE_COLOR[Number(attr(cue, 'TYPE'))]
      return {
        ms: Number(attr(cue, 'START')),
        kind,
        color: kind === 0 ? null : rekordboxColorOf(color ?? null),
      }
    })
}

function entryOf(track: Track | undefined, bootVolume: string): SourcePlaylistEntry {
  if (!track) return { path: null, separator: false, meta: {} }
  const head = track.block.match(/<ENTRY\b[^>]*>/)?.[0] ?? ''
  const info = track.block.match(/<INFO\b[^>]*>/)?.[0] ?? ''
  return {
    path: traktorFileOf(track.block, bootVolume),
    separator: false,
    meta: metaOf(track.block),
    contentId: traktorContentId(track.key),
    preview: {
      title: attr(head, 'TITLE').trim(),
      artist: attr(head, 'ARTIST').trim(),
      durationSec: Number(attr(info, 'PLAYTIME_FLOAT') || attr(info, 'PLAYTIME')) || 0,
      cues: cuesOf(track.block),
    },
  }
}

// The collection's keys and, for adding a dropped file, the keys behind each file path
// (composed, as macOS may hand the same name decomposed).
export function traktorCollectionIndex(
  nml: string,
  bootVolume: string,
): { keys: Set<string>; byPath: Map<string, string[]> } {
  const tracks = collection(nml)
  const byPath = new Map<string, string[]>()
  for (const t of tracks) {
    const path = traktorFileOf(t.block, bootVolume).normalize('NFC')
    byPath.set(path, [...(byPath.get(path) ?? []), t.key])
  }
  return { keys: new Set(tracks.map((t) => t.key)), byPath }
}

// A separator is recognised by what it is, as in rekordbox: a blank file of a second or two.
function isSeparator(track: Track): boolean {
  const head = track.block.match(/<ENTRY\b[^>]*>/)?.[0] ?? ''
  const playtime = attr(track.block.match(/<INFO\b[^>]*>/)?.[0] ?? '', 'PLAYTIME')
  return attr(head, 'TITLE').trim() === '' && playtime !== '' && Number(playtime) <= 2
}

// The DJ's own separator, to copy when one is inserted: among the separator files, the one
// the playlists use most.
export function traktorSeparatorKey(nml: string): string | null {
  const separators = new Set(
    collection(nml)
      .filter(isSeparator)
      .map((t) => t.key),
  )
  const uses = new Map<string, number>()
  const walk = (node: ModelNode): void => {
    for (const row of node.rows)
      if (separators.has(row.key)) uses.set(row.key, (uses.get(row.key) ?? 0) + 1)
    node.children.forEach(walk)
  }
  const model = parsePlaylists(nml)
  if (model) walk(model.root)
  return [...uses].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
}

function recentSince(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - RECENT_DAYS).getTime()
}

// Traktor dates an import to the day only; within a day the later ENTRY is the later
// import, since Traktor appends new tracks to the end of the collection.
function newestFirst(tracks: Track[]): Track[] {
  return tracks
    .map((t, order) => ({ t, order }))
    .sort((a, b) => b.t.imported - a.t.imported || b.order - a.order)
    .map(({ t }) => t)
}

function recentTracks(nml: string, now: Date): Track[] {
  const since = recentSince(now)
  return newestFirst(collection(nml).filter((t) => t.imported >= since))
}

export function readTraktorRecentCount(nml: string, now: Date = new Date()): number {
  return recentTracks(nml, now).length
}

function allTracks(nml: string): Track[] {
  return newestFirst(collection(nml).filter((t) => !isSeparator(t)))
}

export function readTraktorTrackCount(nml: string): number {
  return allTracks(nml).length
}

export function readTraktorPlaylist(
  nml: string,
  id: string,
  bootVolume: string,
  now: Date = new Date(),
): SourcePlaylistEntry[] {
  if (id === RECENTLY_ADDED_ID) return recentTracks(nml, now).map((t) => entryOf(t, bootVolume))
  if (id === ALL_TRACKS_ID) return allTracks(nml).map((t) => entryOf(t, bootVolume))
  const list = nodeById(parsePlaylists(nml), id)
  if (list?.kind !== 'playlist') return []
  const tracks = collection(nml)
  const byKey = new Map(tracks.map((t) => [t.key, t]))
  const separators = new Set(tracks.filter(isSeparator).map((t) => t.key))
  return list.rows.map((row, i) => ({
    ...entryOf(byKey.get(row.key), bootVolume),
    ...(separators.has(row.key) && { separator: true }),
    linkId: rowLinkId(list, i),
  }))
}

export function readTraktorMembership(
  nml: string,
  paths: string[],
  bootVolume: string,
): Record<string, string[]> {
  const { byPath } = traktorCollectionIndex(nml, bootVolume)
  const lists: ModelNode[] = []
  const walk = (node: ModelNode): void => {
    if (node.kind === 'playlist' && !(node.parent?.id === 'root' && node.name === TRAKTOR_HISTORY))
      lists.push(node)
    node.children.forEach(walk)
  }
  const model = parsePlaylists(nml)
  if (model) walk(model.root)
  const out: Record<string, string[]> = {}
  for (const path of paths) {
    const keys = byPath.get(path.normalize('NFC')) ?? []
    if (keys.length !== 1) continue
    out[path] = lists.filter((l) => l.rows.some((r) => r.key === keys[0])).map((l) => l.id)
  }
  return out
}
