import { HOT_KINDS } from '../shared/cueRules'
import { engineTrackId } from '../shared/engineContent'
import { nearestHotCueColor } from '../shared/rekordboxCueColors'
import type { CueWaveColumn, TrackCueRow, TrackCues } from '../shared/types'
import {
  decodeBeatGrid,
  decodeOverview,
  decodeQuickCues,
  decodeTrackData,
  type EngineBeatMarker,
  inflateEngineBlob,
} from './engineBlobs'
import type { EngineDb } from './enginePlaylists'
import { cueFingerprint } from './rekordboxCues'

export interface EnginePerformance {
  length: number | null
  trackData: Uint8Array | null
  beatData: Uint8Array | null
  quickCues: Uint8Array | null
  overviewWaveFormData: Uint8Array | null
}

function inflated<T>(blob: Uint8Array | null, decode: (raw: Buffer) => T | null): T | null {
  if (!blob || blob.length <= 4) return null
  try {
    return decode(inflateEngineBlob(blob))
  } catch {
    return null
  }
}

function beatsOf(markers: EngineBeatMarker[], sampleRate: number, durationMs: number) {
  const sorted = [...markers].sort((a, b) => a.sample - b.sample)
  const grid: { ms: number; beat: number }[] = []
  const push = (sample: number, beat: number): void => {
    const ms = (sample / sampleRate) * 1000
    if (ms >= 0 && ms <= durationMs) grid.push({ ms, beat: (((beat % 4) + 4) % 4) + 1 })
  }
  sorted.forEach((a, i) => {
    const b = sorted[i + 1]
    if (!b) {
      push(a.sample, a.beat)
      return
    }
    const step = (b.sample - a.sample) / (b.beat - a.beat)
    for (let n = a.beat; n < b.beat; n++) push(a.sample + (n - a.beat) * step, n)
  })
  return grid
}

export function engineHotCues(quickCues: Uint8Array | null, sampleRate: number): TrackCueRow[] {
  const decoded = inflated(quickCues, decodeQuickCues)
  if (!decoded) return []
  return decoded.slots.slice(0, HOT_KINDS.length).flatMap((slot, i) =>
    slot.cue
      ? [
          {
            id: String(i),
            ms: (slot.cue.sample / sampleRate) * 1000,
            kind: HOT_KINDS[i],
            color: nearestHotCueColor(slot.cue.argb),
          },
        ]
      : [],
  )
}

function waveOf(overview: Uint8Array | null): CueWaveColumn[] | null {
  const decoded = inflated(overview, decodeOverview)
  if (!decoded || decoded.entries.length === 0) return null
  const peak = Math.max(...decoded.max, ...decoded.entries.map((e) => Math.max(...e))) || 1
  return decoded.entries.map((e) => ({ h: Math.min(1, Math.max(...e) / peak), rgb: null }))
}

export function engineCuesOf(
  contentId: string,
  perf: EnginePerformance,
  options: { wave?: boolean } = {},
): TrackCues {
  const track = inflated(perf.trackData, decodeTrackData)
  const beats = inflated(perf.beatData, decodeBeatGrid)
  const sampleRate = track?.sampleRate ?? 0
  const durationMs =
    track && sampleRate > 0 ? (track.sampleCount / sampleRate) * 1000 : (perf.length ?? 0) * 1000
  const grid = beats && sampleRate > 0 ? beatsOf(beats.markers, sampleRate, durationMs) : []
  const cues = sampleRate > 0 ? engineHotCues(perf.quickCues, sampleRate) : []
  const base = {
    contentId,
    strong: [],
    phrases: [],
    cues,
    durationMs,
    fingerprint: cueFingerprint(cues),
  }
  if (grid.length === 0) return { ...base, analysed: false, grid: [], wave: null }
  return {
    ...base,
    analysed: true,
    grid,
    wave: options.wave === false ? null : waveOf(perf.overviewWaveFormData),
  }
}

export function readEnginePerformance(db: EngineDb, trackId: number): EnginePerformance | null {
  return (
    (db
      .prepare(
        `SELECT t.length, p.trackData, p.beatData, p.quickCues, p.overviewWaveFormData
           FROM Track t LEFT JOIN PerformanceData p ON p.trackId = t.id WHERE t.id = ?`,
      )
      .get(trackId) as EnginePerformance | undefined) ?? null
  )
}

export function readEngineTrackCues(
  db: EngineDb,
  contentId: string,
  options: { wave?: boolean } = {},
): TrackCues | null {
  const trackId = engineTrackId(contentId)
  const perf = trackId === null ? null : readEnginePerformance(db, trackId)
  return perf ? engineCuesOf(contentId, perf, options) : null
}
