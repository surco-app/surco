import { HOT_KINDS } from '../shared/cueRules'
import { gridFingerprint } from '../shared/gridEdit'
import { nearestHotCueColor } from '../shared/rekordboxCueColors'
import { seratoFileOf } from '../shared/seratoContent'
import type { SeratoCue, SeratoTempoMap } from '../shared/seratoMarkers'
import type { TrackCueRow, TrackCues } from '../shared/types'
import { cueFingerprint } from './rekordboxCues'
import { seratoLeadOfFile } from './seratoClock'
import { readSeratoTrack } from './seratoTags'

const BEATS_PER_BAR = 4

export function tempoGrid(
  tempoMap: SeratoTempoMap,
  leadMs: number,
  durationMs: number,
): { ms: number; beat: number }[] {
  const first = tempoMap.firstBeatMs - leadMs
  const period = 60000 / tempoMap.bpm
  const grid: { ms: number; beat: number }[] = []
  for (let k = -Math.floor(first / period); first + k * period <= durationMs; k++) {
    const ms = first + k * period
    if (ms >= 0)
      grid.push({ ms, beat: (((k % BEATS_PER_BAR) + BEATS_PER_BAR) % BEATS_PER_BAR) + 1 })
  }
  return grid
}

export function seratoCueRows(cues: SeratoCue[], leadMs: number): TrackCueRow[] {
  return cues
    .filter((c) => c.index < HOT_KINDS.length)
    .map((c) => ({
      id: String(c.index),
      ms: Math.max(0, c.ms - leadMs),
      kind: HOT_KINDS[c.index],
      color: nearestHotCueColor((0xff000000 | c.color) >>> 0),
      ...(c.name && { name: c.name }),
    }))
}

export async function seratoTrackCuesOf(
  contentId: string,
  track: NonNullable<ReturnType<typeof readSeratoTrack>>,
): Promise<TrackCues> {
  const file = seratoFileOf(contentId)
  const lead = await seratoLeadOfFile(file, track.sampleRate)
  const grid = track.tempoMap ? tempoGrid(track.tempoMap, lead, track.durationMs) : []
  const cues = seratoCueRows(track.markers?.cues ?? [], lead)
  return {
    contentId,
    analysed: track.tempoMap !== null,
    grid,
    gridFingerprint: gridFingerprint(grid),
    strong: [],
    phrases: [],
    cues,
    loops: (track.markers?.loops ?? []).map((l) => ({
      id: String(l.index),
      startMs: l.startMs - lead,
      endMs: l.endMs - lead,
      ...(l.name && { name: l.name }),
    })),
    wave: null,
    durationMs: track.durationMs,
    fingerprint: cueFingerprint(cues),
  }
}

export async function readSeratoTrackCues(
  contentIds: string[],
): Promise<Record<string, TrackCues | null>> {
  const out: Record<string, TrackCues | null> = {}
  for (const contentId of contentIds) {
    const track = readSeratoTrack(seratoFileOf(contentId))
    out[contentId] = track ? await seratoTrackCuesOf(contentId, track) : null
  }
  return out
}
