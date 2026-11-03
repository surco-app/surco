import { HOT_KINDS } from '../shared/cueRules'
import { gridFingerprint } from '../shared/gridEdit'
import { nearestHotCueColor } from '../shared/rekordboxCueColors'
import { seratoFileOf } from '../shared/seratoContent'
import type { SeratoCue, SeratoTempoMap } from '../shared/seratoMarkers'
import type { TrackCueRow } from '../shared/types'
import type { CueQueue, CueSource } from './cueSource'
import { cueFingerprint } from './rekordboxCues'
import { seratoLeadOfFile } from './seratoClock'
import { readSeratoTrack } from './seratoTags'

const BEATS_PER_BAR = 4

function tempoGrid(
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
      ms: c.ms - leadMs,
      kind: HOT_KINDS[c.index],
      color: nearestHotCueColor((0xff000000 | c.color) >>> 0),
      ...(c.name && { name: c.name }),
    }))
}

export function seratoCueSource(host: {
  words: (file: string) => Promise<Uint16Array | null>
  queue: CueQueue
  applyQuietly: () => void
}): CueSource {
  return {
    trackCues: async (contentId) => {
      const file = seratoFileOf(contentId)
      const track = readSeratoTrack(file)
      if (!track) return null
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
    },
    waveDetail: async (contentId) => host.words(seratoFileOf(contentId)),
    dropInput: async () => null,
    auditionLead: async () => 0,
    surcoGrid: async () => null,
    gridFit: async () => null,
    gridVerdict: async () => null,
    queuedWanted: async () => [],
    queue: host.queue,
    applyQuietly: host.applyQuietly,
  }
}
