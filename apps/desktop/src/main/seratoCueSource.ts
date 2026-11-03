import { HOT_KINDS } from '../shared/cueRules'
import { gridFingerprint } from '../shared/gridEdit'
import { nearestHotCueColor } from '../shared/rekordboxCueColors'
import { seratoFileOf } from '../shared/seratoContent'
import type { TrackCueRow } from '../shared/types'
import type { CueReader } from './cueSource'
import { cueFingerprint } from './rekordboxCues'
import { readSeratoTrack } from './seratoTags'

export function seratoCueSource(host: {
  words: (file: string) => Promise<Uint16Array | null>
}): CueReader {
  return {
    trackCues: async (contentId) => {
      const track = readSeratoTrack(seratoFileOf(contentId))
      if (!track) return null
      const cues: TrackCueRow[] = (track.markers?.cues ?? [])
        .filter((c) => c.index < HOT_KINDS.length)
        .map((c) => ({
          id: String(c.index),
          ms: c.ms,
          kind: HOT_KINDS[c.index],
          color: nearestHotCueColor((0xff000000 | c.color) >>> 0),
          ...(c.name && { name: c.name }),
        }))
      return {
        contentId,
        analysed: false,
        grid: [],
        gridFingerprint: gridFingerprint([]),
        strong: [],
        phrases: [],
        cues,
        loops: (track.markers?.loops ?? []).map((l) => ({
          id: String(l.index),
          startMs: l.startMs,
          endMs: l.endMs,
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
  }
}
