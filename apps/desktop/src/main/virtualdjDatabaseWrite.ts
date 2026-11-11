import { escapeXml } from '../shared/xml'
import { attr, withAttr } from './traktorNml'
import { parsePoi, songOpenRe, tagRe, type VirtualdjPoi } from './virtualdjDatabase'

export type VirtualdjArgb = number
export type VirtualdjCueWrite = {
  num: number
  seconds: number
  name?: string
  color?: VirtualdjArgb
}
export type VirtualdjLoopWrite = {
  slot: number
  seconds: number
  sizeBeats: number
  name?: string
  color?: VirtualdjArgb
}

const NL = '\r\n'
const SONG_CLOSE = '</Song>'
const DATABASE_CLOSE = '</VirtualDJ_Database>'

interface SongSpan {
  openStart: number
  openEnd: number
  bodyEnd: number
}

function hasSong(xml: string, path: string): boolean {
  for (const m of xml.matchAll(songOpenRe())) if (attr(m[1], 'FilePath') === path) return true
  return false
}

function findSong(xml: string, path: string): SongSpan | null {
  if (!xml.includes(NL)) return null
  for (const m of xml.matchAll(songOpenRe())) {
    if (m[1].trimEnd().endsWith('/') || attr(m[1], 'FilePath') !== path) continue
    const openEnd = m.index + m[0].length
    const bodyEnd = xml.indexOf(SONG_CLOSE, openEnd)
    return bodyEnd < 0 ? null : { openStart: m.index, openEnd, bodyEnd }
  }
  return null
}

function withBody(xml: string, path: string, edit: (lines: string[]) => string[]): string | null {
  const span = findSong(xml, path)
  if (!span) return null
  const body = edit(xml.slice(span.openEnd, span.bodyEnd).split(NL)).join(NL)
  return `${xml.slice(0, span.openEnd)}${body}${xml.slice(span.bodyEnd)}`
}

const round6 = (n: number) => Number(n.toFixed(6))
const placeable = (n: number) => Number.isFinite(n) && n < 1e21 && round6(n) >= 0

function decimal(n: number): string {
  const s = round6(n).toFixed(6).replace(/0+$/, '')
  return s.endsWith('.') ? `${s}0` : s
}

const isTag = (line: string, name: string) => line.trimStart().startsWith(`<${name} `)
const poiOf = (line: string) => (isTag(line, 'Poi') ? parsePoi(line) : null)
const nameAttr = (name?: string) => (name ? ` Name="${escapeXml(name)}"` : '')
const unsigned = (color?: number) => (color === undefined ? undefined : color >>> 0)
const colorAttr = (color?: number) => (color === undefined ? '' : ` Color="${unsigned(color)}"`)
const sameLabel = (poi: VirtualdjPoi, item: { name?: string; color?: number }) =>
  (poi.name ?? '') === (item.name ?? '') && unsigned(poi.color) === unsigned(item.color)

const cueLine = (c: VirtualdjCueWrite) =>
  `  <Poi${nameAttr(c.name)} Pos="${decimal(c.seconds)}" Num="${c.num}"${colorAttr(c.color)} Type="cue" />`
const loopLine = (l: VirtualdjLoopWrite) =>
  `  <Poi${nameAttr(l.name)} Pos="${decimal(l.seconds)}" Num="-1"${colorAttr(l.color)} Type="loop" Size="${decimal(l.sizeBeats)}" Slot="${l.slot}" />`

function replacePois<T>(
  lines: string[],
  owns: (poi: VirtualdjPoi) => number | null,
  items: T[],
  keyOf: (item: T) => number,
  same: (poi: VirtualdjPoi, item: T) => boolean,
  render: (item: T) => string,
): string[] {
  const pending = new Map(items.map((item) => [keyOf(item), item]))
  const kept: string[] = []
  for (const line of lines) {
    const poi = poiOf(line)
    const key = poi ? owns(poi) : null
    if (poi === null || key === null) {
      kept.push(line)
      continue
    }
    const item = pending.get(key)
    if (item === undefined) continue
    pending.delete(key)
    kept.push(same(poi, item) ? line : render(item))
  }
  const close = kept.pop() ?? ''
  return [...kept, ...[...pending.values()].map(render), close]
}

export function withVirtualdjCues(
  xml: string,
  path: string,
  cues: VirtualdjCueWrite[],
  loops?: VirtualdjLoopWrite[],
): string | null {
  const cuesOk = cues.every(
    (c) => Number.isInteger(c.num) && c.num >= 1 && c.num <= 8 && placeable(c.seconds),
  )
  const loopsOk = (loops ?? []).every((l) => placeable(l.seconds) && placeable(l.sizeBeats))
  if (!cuesOk || !loopsOk) return null
  return withBody(xml, path, (lines) => {
    const withCues = replacePois(
      lines,
      (poi) =>
        poi.kind === 'cue' && poi.num !== null && poi.num >= 1 && poi.num <= 8 ? poi.num : null,
      cues,
      (c) => c.num,
      (poi, c) => poi.seconds === round6(c.seconds) && sameLabel(poi, c),
      cueLine,
    )
    if (loops === undefined) return withCues
    return replacePois(
      withCues,
      (poi) => (poi.kind === 'loop' ? (poi.slot ?? 0) : null),
      loops,
      (l) => l.slot,
      (poi, l) =>
        poi.seconds === round6(l.seconds) &&
        poi.sizeBeats === round6(l.sizeBeats) &&
        sameLabel(poi, l),
      loopLine,
    )
  })
}

function secondsPerBeat(lines: string[]): number {
  const body = lines.join(NL)
  const of = (tag: string) => Number(attr(body.match(tagRe(tag))?.[0] ?? '', 'Bpm')) || 0
  return of('Scan') || of('Tags')
}

function withPhaseShifted(scan: string, shiftSeconds: number, beat: number): string {
  const phase = attr(scan, 'Phase')
  if (phase === '') return scan
  const shifted = round6(Number(phase) + shiftSeconds)
  const beats = shifted < 0 && beat > 0 ? Math.ceil(-shifted / beat) : 0
  return withAttr(scan, 'Phase', decimal(shifted + beats * beat))
}

export function withVirtualdjSongMoved(
  xml: string,
  from: string,
  to: { path: string; size: number; lengthSeconds?: number },
  shiftSeconds: number,
  keepUntilSeconds: number | null,
): string | null {
  if (!Number.isFinite(shiftSeconds)) return null
  if (to.lengthSeconds !== undefined && !placeable(to.lengthSeconds)) return null
  const span = findSong(xml, from)
  if (!span || (to.path !== from && hasSong(xml, to.path))) return null
  const open = setAttr(
    setAttr(xml.slice(span.openStart, span.openEnd), 'FilePath', to.path),
    'FileSize',
    `${to.size}`,
  )
  const lines = xml.slice(span.openEnd, span.bodyEnd).split(NL)
  const beat = secondsPerBeat(lines)
  const moved = lines.flatMap((line) => {
    if (to.lengthSeconds !== undefined && isTag(line, 'Infos'))
      return [setAttr(line, 'SongLength', decimal(to.lengthSeconds))]
    if (shiftSeconds !== 0 && isTag(line, 'Scan'))
      return [withPhaseShifted(line, shiftSeconds, beat)]
    const poi = poiOf(line)
    if (!poi) return [line]
    const start = round6(poi.seconds + shiftSeconds)
    const end = start + (poi.kind === 'loop' ? (poi.sizeBeats ?? 0) * beat : 0)
    if (start < 0) return []
    if (keepUntilSeconds !== null && (start >= keepUntilSeconds || end > keepUntilSeconds))
      return []
    return [shiftSeconds === 0 ? line : withAttr(line, 'Pos', decimal(start))]
  })
  return `${xml.slice(0, span.openStart)}${open}${moved.join(NL)}${xml.slice(span.bodyEnd)}`
}

function setAttr(tag: string, name: string, value: string): string {
  const escaped = escapeXml(value)
  if (new RegExp(`\\s${name}="`).test(tag))
    return attr(tag, name) === value ? tag : withAttr(tag, name, escaped)
  return tag.replace(/\s*\/?>$/, (end) => ` ${name}="${escaped}"${end}`)
}

export function withVirtualdjTags(
  xml: string,
  path: string,
  tags: Partial<Record<'Title' | 'Author' | 'Album' | 'Genre', string>>,
): string | null {
  const withTags = (line: string) => {
    let out = line
    for (const [name, value] of Object.entries(tags))
      if (value !== undefined) out = setAttr(out, name, value)
    return out
  }
  return withBody(xml, path, (lines) =>
    lines.some((line) => isTag(line, 'Tags'))
      ? lines.map((line) => (isTag(line, 'Tags') ? withTags(line) : line))
      : [lines[0], withTags('  <Tags />'), ...lines.slice(1)],
  )
}

export function withVirtualdjSongAdded(
  xml: string,
  song: { path: string; size: number; title: string; artist: string; album: string; genre: string },
): string | null {
  if (!xml.includes(NL) || hasSong(xml, song.path)) return null
  const at = xml.lastIndexOf(DATABASE_CLOSE)
  if (at < 0) return null
  const tags = (
    [
      ['Author', song.artist],
      ['Title', song.title],
      ['Genre', song.genre],
      ['Album', song.album],
    ] as const
  )
    .filter(([, value]) => value !== '')
    .map(([name, value]) => ` ${name}="${escapeXml(value)}"`)
    .join('')
  const block = [
    ` <Song FilePath="${escapeXml(song.path)}" FileSize="${song.size}" Flag="268435456">`,
    `  <Tags${tags} />`,
    ` ${SONG_CLOSE}`,
    '',
  ].join(NL)
  return `${xml.slice(0, at)}${block}${xml.slice(at)}`
}
