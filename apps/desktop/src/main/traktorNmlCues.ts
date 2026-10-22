import { nearestHotCueColor } from '../shared/rekordboxCueColors'
import { attr, findEntries } from './traktorNml'

const GRID_TYPE = 4
const CUE_RE = /<CUE_V2\b[^>]*>/g
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

export interface TraktorCue {
  name: string
  type: number
  startMs: number
  lengthMs: number
  hotcue: number
  color: string | null
}

export interface NmlLocation {
  volume: string
  dir: string
  file: string
}

const locationKey = (l: NmlLocation): string =>
  [l.volume, l.dir, l.file].map((part) => part.normalize('NFC')).join('\0')

export function nmlCuesAt(nml: string, location: NmlLocation): TraktorCue[] | null {
  const wanted = locationKey(location)
  const entry = findEntries(nml).find((e) => locationKey(e) === wanted)
  if (!entry) return null
  const block = nml.slice(entry.start, entry.end)
  return [...block.matchAll(CUE_RE)]
    .map(([cue]) => cue)
    .filter((cue) => Number(attr(cue, 'TYPE')) !== GRID_TYPE)
    .map((cue) => ({
      name: attr(cue, 'NAME'),
      type: Number(attr(cue, 'TYPE')),
      startMs: Number(attr(cue, 'START')),
      lengthMs: Number(attr(cue, 'LEN')),
      hotcue: Number(attr(cue, 'HOTCUE') || '-1'),
      color: attr(cue, 'COLOR') || null,
    }))
}

export function rekordboxColorOf(color: string | null): number | null {
  if (color === null || !HEX_COLOR.test(color)) return null
  return nearestHotCueColor((0xff000000 | Number.parseInt(color.slice(1), 16)) >>> 0)
}
