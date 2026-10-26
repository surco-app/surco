import { HOT_KINDS } from '../shared/cueRules'
import { RECENTLY_ADDED_ID } from '../shared/recentlyAdded'
import type { AppleMusicTrackMeta, RowCue, SourceNode, SourcePlaylistEntry } from '../shared/types'
import { attr, findEntries } from './traktorNml'
import { rekordboxColorOf } from './traktorNmlCues'

const GRID_TYPE = 4
const RECENT_DAYS = 30
const TAG_RE = /<(\/?)(NODE|PLAYLIST|PRIMARYKEY)\b([^>]*)>/g
const CUE_RE = /<CUE_V2\b[^>]*>/g

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

interface Node {
  kind: 'folder' | 'playlist' | 'smartlist'
  name: string
  uuid: string
  keys: string[]
  children: Node[]
}

// Traktor nests NODEs inside SUBNODES and keeps a playlist's tracks as PRIMARYKEYs that
// name the collection ENTRY by volume, folder and file. The document is walked tag by tag
// rather than parsed, as everywhere else Surco reads an NML.
function readNodes(nml: string): Node[] {
  const start = nml.indexOf('<PLAYLISTS>')
  if (start < 0) return []
  const root: Node = { kind: 'folder', name: '', uuid: '', keys: [], children: [] }
  const stack = [root]
  for (const [tag, closing, name, attrs] of nml.slice(start).matchAll(TAG_RE)) {
    const at = stack[stack.length - 1]
    if (name === 'NODE' && closing) {
      if (stack.length > 1) stack.pop()
    } else if (name === 'NODE') {
      const type = attr(attrs, 'TYPE')
      const node: Node = {
        kind: type === 'FOLDER' ? 'folder' : type === 'PLAYLIST' ? 'playlist' : 'smartlist',
        name: attr(attrs, 'NAME'),
        uuid: '',
        keys: [],
        children: [],
      }
      at.children.push(node)
      if (!tag.endsWith('/>')) stack.push(node)
    } else if (name === 'PLAYLIST' && !closing) at.uuid = attr(attrs, 'UUID')
    else if (name === 'PRIMARYKEY' && !closing) at.keys.push(attr(attrs, 'KEY'))
  }
  const top = root.children[0]
  return top?.name === '$ROOT' ? top.children : root.children
}

function toTree(nodes: Node[], folders: string[]): SourceNode[] {
  return nodes.flatMap((n): SourceNode[] => {
    if (n.kind === 'smartlist') return []
    if (n.kind === 'playlist')
      return [{ id: n.uuid, name: n.name, kind: 'playlist', count: n.keys.length }]
    const path = [...folders, n.name]
    const children = toTree(n.children, path)
    return [
      {
        id: `folder:${path.join('/')}`,
        name: n.name,
        kind: 'folder',
        count: children.length,
        children,
      },
    ]
  })
}

export function readTraktorTree(nml: string): SourceNode[] {
  return toTree(readNodes(nml), [])
}

function findPlaylist(nodes: Node[], uuid: string): Node | null {
  for (const n of nodes) {
    if (n.kind === 'playlist' && n.uuid === uuid) return n
    const inner = findPlaylist(n.children, uuid)
    if (inner) return inner
  }
  return null
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
  return findEntries(nml).map((e) => {
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
function pathOf(block: string, bootVolume: string): string {
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
    .map((cue) => {
      const slot = Number(attr(cue, 'HOTCUE') || '-1')
      return {
        ms: Number(attr(cue, 'START')),
        kind: HOT_KINDS[slot] ?? 0,
        color: rekordboxColorOf(attr(cue, 'COLOR') || null),
      }
    })
}

function entryOf(track: Track | undefined, bootVolume: string): SourcePlaylistEntry {
  if (!track) return { path: null, separator: false, meta: {} }
  const head = track.block.match(/<ENTRY\b[^>]*>/)?.[0] ?? ''
  const info = track.block.match(/<INFO\b[^>]*>/)?.[0] ?? ''
  return {
    path: pathOf(track.block, bootVolume),
    separator: false,
    meta: metaOf(track.block),
    preview: {
      title: attr(head, 'TITLE').trim(),
      artist: attr(head, 'ARTIST').trim(),
      durationSec: Number(attr(info, 'PLAYTIME_FLOAT') || attr(info, 'PLAYTIME')) || 0,
      cues: cuesOf(track.block),
    },
  }
}

function recentSince(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - RECENT_DAYS).getTime()
}

// Traktor dates an import to the day only; within a day the later ENTRY is the later
// import, since Traktor appends new tracks to the end of the collection.
function recentTracks(nml: string, now: Date): Track[] {
  const since = recentSince(now)
  return collection(nml)
    .map((t, order) => ({ t, order }))
    .filter(({ t }) => t.imported >= since)
    .sort((a, b) => b.t.imported - a.t.imported || b.order - a.order)
    .map(({ t }) => t)
}

export function readTraktorRecentCount(nml: string, now: Date = new Date()): number {
  return recentTracks(nml, now).length
}

export function readTraktorPlaylist(
  nml: string,
  id: string,
  bootVolume: string,
  now: Date = new Date(),
): SourcePlaylistEntry[] {
  if (id === RECENTLY_ADDED_ID) return recentTracks(nml, now).map((t) => entryOf(t, bootVolume))
  const list = findPlaylist(readNodes(nml), id)
  if (!list) return []
  const byKey = new Map(collection(nml).map((t) => [t.key, t]))
  return list.keys.map((key) => entryOf(byKey.get(key), bootVolume))
}
