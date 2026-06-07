import type { TrackItem } from '../types'
import { qualityVerdict, type Verdict } from './quality'

// The per-track quality verdict surfaced as a row badge, so a whole dropped folder
// can be triaged at a glance instead of opening each track. 'unanalyzed' covers both
// "spectrum not measured yet" and "cutoff pass was inconclusive" — neither has a
// verdict to show, and both leave the row blank.
export type TrackQuality = Verdict | 'unanalyzed'

export function trackQuality(track: TrackItem): TrackQuality {
  const s = track.spectrum
  if (!s || s.cutoffHz === null) return 'unanalyzed'
  return qualityVerdict(s.cutoffHz, s.sampleRateHz)
}

// The tracks a "analyze quality" sweep should measure: those with no spectrum yet that
// aren't already being analyzed (by a hover prefetch or an earlier worker), so the run
// never double-spawns ffmpeg for the same file.
export function tracksToAnalyze(tracks: TrackItem[], inFlight: ReadonlySet<string>): TrackItem[] {
  return tracks.filter((t) => !t.spectrum && !inFlight.has(t.id))
}

// The list filter modes: everything, just the suspect (likely fake-lossless) rips, or
// the ones still without a verdict.
export type QualityFilter = 'all' | 'suspect' | 'unanalyzed'

export function filterByQuality(tracks: TrackItem[], filter: QualityFilter): TrackItem[] {
  if (filter === 'all') return tracks
  return tracks.filter((t) => trackQuality(t) === filter)
}

// Tallies for the filter chips, so the bar can show "5 suspect" without the caller
// walking the list per chip.
export function qualityCounts(tracks: TrackItem[]): { suspect: number; unanalyzed: number } {
  let suspect = 0
  let unanalyzed = 0
  for (const t of tracks) {
    const q = trackQuality(t)
    if (q === 'suspect') suspect += 1
    else if (q === 'unanalyzed') unanalyzed += 1
  }
  return { suspect, unanalyzed }
}
