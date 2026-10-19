import { pathToFileURL } from 'node:url'
import { escapeXml } from '../shared/xml'
import type { Beat } from './anlz'
import type { ExportSelection, ExportTrack } from './usbExportSource'

// baken reads a rekordbox collection XML (DJ_PLAYLISTS) and writes the stick from it. Surco
// builds that XML from master.db; this is gen_xml2.py from the spike, whose output gave a
// stick Vicent's players read "perfectly" (16/10), ported with its measured rules.

const KINDS: Record<number, string> = {
  1: 'MP3 File',
  4: 'M4A File',
  5: 'FLAC File',
  11: 'WAV File',
  12: 'AIFF File',
}

// rekordbox's djmdCue.Kind for hot cues skips 4: A..C are 1..3 and D..H are 5..9.
export function hotCueNum(kind: number): number | null {
  if (kind === 0) return -1
  if (kind >= 1 && kind <= 3) return kind - 1
  if (kind >= 5 && kind <= 9) return kind - 2
  return null
}

export interface XmlTrackFacts {
  size: number
  grid: Beat[]
}

const attrs = (pairs: [string, string | number][]): string =>
  pairs.map(([k, v]) => `${k}="${escapeXml(String(v))}"`).join(' ')

function tempoLines(grid: Beat[]): string[] {
  const lines: string[] = []
  let last: number | null = null
  for (const b of grid) {
    const bpm = Math.round(b.bpm * 100) / 100
    if (bpm === last) continue
    last = bpm
    lines.push(
      `<TEMPO Inizio="${(b.ms / 1000).toFixed(3)}" Bpm="${bpm.toFixed(2)}" Metro="4/4" Battito="${b.beat}"/>`,
    )
  }
  return lines
}

function cueLines(t: ExportTrack): string[] {
  // The query orders by time only; the kind breaks ties so the XML is the same every run.
  const ordered = [...t.cues].sort((x, y) => x.inMs - y.inMs || x.kind - y.kind)
  return ordered.flatMap((c) => {
    const num = hotCueNum(c.kind)
    if (num === null) return []
    const loop = c.outMs > 0
    const head = attrs([
      ['Name', c.comment],
      ['Type', loop ? 4 : 0],
      ['Start', (c.inMs / 1000).toFixed(3)],
      ...(loop ? ([['End', (c.outMs / 1000).toFixed(3)]] as [string, string][]) : []),
      ['Num', num],
    ])
    return [`<POSITION_MARK ${head}/>`]
  })
}

function trackXml(t: ExportTrack, f: XmlTrackFacts, platform: NodeJS.Platform): string {
  const head = attrs([
    ['TrackID', t.id],
    ['Name', t.title],
    ['Artist', t.artist],
    ['Composer', t.composer],
    ['Album', t.album],
    ['Genre', t.genre],
    ['Kind', KINDS[t.fileType] ?? ''],
    ['Size', f.size],
    ['TotalTime', t.lengthSec],
    ['DiscNumber', t.discNo],
    ['TrackNumber', t.trackNo],
    ['Year', t.year],
    ['AverageBpm', t.bpm.toFixed(2)],
    ['DateAdded', t.dateAdded],
    ['BitRate', t.bitRate],
    ['SampleRate', t.sampleRate],
    ['Comments', t.comment],
    ['PlayCount', t.playCount],
    // rekordbox XML rates 0..255; 51 per star.
    ['Rating', Math.min(Math.max(t.rating, 0), 5) * 51],
    // rekordbox's form, file://localhost plus the encoded path (file://localhost/E:/... on
    // Windows). pathToFileURL encodes spaces, # and ?, which would otherwise end the URL early.
    [
      'Location',
      `file://localhost${pathToFileURL(t.path, { windows: platform === 'win32' }).pathname}`,
    ],
    ['Remixer', t.remixer],
    ['Tonality', t.key],
    ['Label', t.label],
    ['Mix', t.mix],
  ])
  return [`<TRACK ${head}>`, ...tempoLines(f.grid), ...cueLines(t), '</TRACK>'].join('\n')
}

interface Folder {
  id: string
  name: string
  children: (Folder | string)[]
}

// baken numbers the stick's playlists itself unless each NODE carries the DeviceId the
// stick already knows it by (patch 0005); rekordbox's playlists3.sync points at those.
const deviceId = (
  deviceIds: ReadonlyMap<string, number> | undefined,
  id: string,
): [string, number][] => {
  const n = deviceIds?.get(id)
  return n === undefined ? [] : [['DeviceId', n]]
}

export function buildBakenXml(
  sel: ExportSelection,
  facts: ReadonlyMap<string, XmlTrackFacts>,
  platform: NodeJS.Platform = process.platform,
  deviceIds?: ReadonlyMap<string, number>,
): string {
  const tracks = sel.tracks.filter((t) => facts.has(t.id))
  const root: Folder = { id: 'root', name: 'ROOT', children: [] }
  for (const p of sel.playlists) {
    let at = root
    // By id, not name: two folders may share a name and each has its own DeviceId.
    for (const [i, id] of p.folderIds.entries()) {
      let next = at.children.find((c): c is Folder => typeof c !== 'string' && c.id === id)
      if (!next) {
        next = { id, name: p.folders[i], children: [] }
        at.children.push(next)
      }
      at = next
    }
    const ids = p.trackIds.filter((id) => facts.has(id))
    at.children.push(
      `<NODE ${attrs([
        ['Name', p.name],
        ['Type', 1],
        ['KeyType', 0],
        ['Entries', ids.length],
        ...deviceId(deviceIds, p.id),
      ])}>${ids.map((id) => `<TRACK Key="${escapeXml(id)}"/>`).join('')}</NODE>`,
    )
  }
  const node = (f: Folder): string =>
    [
      `<NODE ${attrs([
        ['Type', 0],
        ['Name', f.name],
        ['Count', f.children.length],
        ...deviceId(deviceIds, f.id),
      ])}>`,
      ...f.children.map((c) => (typeof c === 'string' ? c : node(c))),
      '</NODE>',
    ].join('\n')
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<DJ_PLAYLISTS Version="1.0.0">',
    '<PRODUCT Name="rekordbox" Version="7.2.19" Company="AlphaTheta"/>',
    `<COLLECTION Entries="${tracks.length}">`,
    ...tracks.map((t) => trackXml(t, facts.get(t.id) as XmlTrackFacts, platform)),
    '</COLLECTION>',
    '<PLAYLISTS>',
    node(root),
    '</PLAYLISTS>',
    '</DJ_PLAYLISTS>',
    '',
  ].join('\n')
}
