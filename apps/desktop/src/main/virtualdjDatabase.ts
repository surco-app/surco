import { attr } from './traktorNml'

export interface VirtualdjPoi {
  kind: 'cue' | 'loop' | 'other'
  num: number | null
  slot?: number
  seconds: number
  name?: string
  color?: number
  sizeBeats?: number
}

export interface VirtualdjSong {
  path: string
  size: number | null
  title: string
  artist: string
  album: string
  genre: string
  year: string
  key: string
  lengthSeconds: number | null
  firstSeen: number | null
  secondsPerBeat: number | null
  phaseSeconds: number | null
  pois: VirtualdjPoi[]
}

const TAG = `(?:"[^"]*"|[^>"])*`
const SONG_OPEN_RE = new RegExp(`<Song\\b(${TAG})>`, 'g')
const poiRe = () => new RegExp(`<Poi\\b${TAG}>`, 'g')
const tagRe = (name: string) => new RegExp(`<${name}\\b${TAG}>`)

function number(value: string): number | null {
  if (value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function parsePoi(tag: string): VirtualdjPoi | null {
  const seconds = number(attr(tag, 'Pos'))
  if (seconds === null) return null
  const type = attr(tag, 'Type')
  const kind = type === 'cue' || type === 'loop' ? type : 'other'
  const poi: VirtualdjPoi = {
    kind,
    num: kind === 'loop' ? null : number(attr(tag, 'Num')),
    seconds,
  }
  const slot = number(attr(tag, 'Slot'))
  if (kind === 'loop' && slot !== null) poi.slot = slot
  const name = attr(tag, 'Name')
  if (name) poi.name = name
  const color = number(attr(tag, 'Color'))
  if (color !== null) poi.color = color
  const size = number(attr(tag, 'Size'))
  if (kind === 'loop' && size !== null) poi.sizeBeats = size
  return poi
}

function parseSong(open: string, body: string): VirtualdjSong | null {
  const path = attr(open, 'FilePath')
  if (!path) return null
  const tags = body.match(tagRe('Tags'))?.[0] ?? ''
  const infos = body.match(tagRe('Infos'))?.[0] ?? ''
  const scan = body.match(tagRe('Scan'))?.[0] ?? ''
  const pois: VirtualdjPoi[] = []
  for (const m of body.matchAll(poiRe())) {
    const poi = parsePoi(m[0])
    if (poi) pois.push(poi)
  }
  return {
    path,
    size: number(attr(open, 'FileSize')),
    title: attr(tags, 'Title'),
    artist: attr(tags, 'Author'),
    album: attr(tags, 'Album'),
    genre: attr(tags, 'Genre'),
    year: attr(tags, 'Year'),
    key: attr(tags, 'Key'),
    lengthSeconds: number(attr(infos, 'SongLength')),
    firstSeen: number(attr(infos, 'FirstSeen')),
    secondsPerBeat: number(attr(scan, 'Bpm')) ?? number(attr(tags, 'Bpm')),
    phaseSeconds: number(attr(scan, 'Phase')),
    pois,
  }
}

export function parseVirtualdjDatabase(xml: string): VirtualdjSong[] {
  const songs: VirtualdjSong[] = []
  for (const m of xml.matchAll(SONG_OPEN_RE)) {
    const selfClosing = m[1].trimEnd().endsWith('/')
    const start = m.index + m[0].length
    const end = selfClosing ? start : xml.indexOf('</Song>', start)
    const song = parseSong(m[1], selfClosing || end < 0 ? '' : xml.slice(start, end))
    if (song) songs.push(song)
  }
  return songs
}
