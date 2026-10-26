import { HOT_KINDS } from '../shared/cueRules'
import { TRAKTOR_HOT_OFFSET, traktorKey } from '../shared/traktorContent'
import type { TrackCueRow, TrackCues } from '../shared/types'
import { cueFingerprint } from './rekordboxCues'
import { attr, findEntries } from './traktorNml'
import { rekordboxColorOf } from './traktorNmlCues'
import { TRAKTOR_TYPE_COLOR } from './traktorPlaylists'

const GRID_TYPE = 4
const CUE_TYPE = 0
const CUE_V2_RE = /<CUE_V2\b[^>]*?(?:\/>|>[\s\S]*?<\/CUE_V2>)/g

export interface TraktorCueElement {
  element: string
  start: number
  end: number
}

export type TraktorCueRow = TrackCueRow & TraktorCueElement

export function traktorEntryBlock(
  nml: string,
  key: string,
): { start: number; end: number; block: string } | null {
  const entry = findEntries(nml).find((e) => `${e.volume}${e.dir}${e.file}` === key)
  return entry
    ? { start: entry.start, end: entry.end, block: nml.slice(entry.start, entry.end) }
    : null
}

export function traktorCueElements(block: string): TraktorCueElement[] {
  return [...block.matchAll(CUE_V2_RE)].map((m) => ({
    element: m[0],
    start: m.index,
    end: m.index + m[0].length,
  }))
}

// Each CUE_V2 is named by its place in the ENTRY: two cues without a button share
// HOTCUE="-1", so the button cannot be the id. Button 1 and the grid marker are Traktor's
// and stay out. A cue the DJ typed as fade, load or loop is marked loop, the flag the cue
// rules already treat as "leave exactly as it is".
export function traktorCueRows(block: string): TraktorCueRow[] {
  return traktorCueElements(block).flatMap((el, i): TraktorCueRow[] => {
    const type = Number(attr(el.element, 'TYPE'))
    const hotcue = Number(attr(el.element, 'HOTCUE') || '-1')
    if (type === GRID_TYPE || hotcue === 0) return []
    const kind = hotcue > 0 ? HOT_KINDS[hotcue - TRAKTOR_HOT_OFFSET] : 0
    if (kind === undefined) return []
    return [
      {
        ...el,
        id: String(i),
        ms: Number(attr(el.element, 'START')),
        kind,
        color: kind === 0 ? null : rekordboxColorOf(TRAKTOR_TYPE_COLOR[type] ?? null),
        ...(type !== CUE_TYPE && { loop: true }),
      },
    ]
  })
}

// Traktor keeps one grid marker per track: the first beat of a bar and the tempo from
// there on. The beats run both ways from it to fill the track.
function gridOf(block: string, durationMs: number): { ms: number; beat: number }[] {
  const marker = traktorCueElements(block)
    .map((el) => el.element)
    .find((el) => Number(attr(el, 'TYPE')) === GRID_TYPE)
  const bpm = Number(attr(marker?.match(/<GRID\b[^>]*>/)?.[0] ?? '', 'BPM'))
  if (!marker || !(bpm > 0)) return []
  const anchor = Number(attr(marker, 'START'))
  const step = 60000 / bpm
  const first = -Math.floor(anchor / step)
  const grid: { ms: number; beat: number }[] = []
  for (let n = first; anchor + n * step <= durationMs; n++)
    grid.push({ ms: anchor + n * step, beat: (((n % 4) + 4) % 4) + 1 })
  return grid
}

export function readTraktorTrackCues(nml: string, contentId: string): TrackCues | null {
  const key = traktorKey(contentId)
  const entry = key === null ? null : traktorEntryBlock(nml, key)
  if (!entry) return null
  const info = entry.block.match(/<INFO\b[^>]*>/)?.[0] ?? ''
  const durationMs = (Number(attr(info, 'PLAYTIME_FLOAT') || attr(info, 'PLAYTIME')) || 0) * 1000
  const cues = traktorCueRows(entry.block).map(({ id, ms, kind, color, loop }) => ({
    id,
    ms,
    kind,
    color,
    ...(loop && { loop }),
  }))
  const grid = gridOf(entry.block, durationMs)
  return {
    contentId,
    analysed: grid.length > 0,
    grid,
    strong: [],
    phrases: [],
    cues,
    wave: null,
    durationMs,
    fingerprint: cueFingerprint(cues),
  }
}
