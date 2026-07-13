import type { DeclickMode, NormalizeConfig } from '../../../shared/types'
import type { TrackItem } from '../types'

type SignatureFields = Pick<
  TrackItem,
  'meta' | 'outputName' | 'coverUrl' | 'coverPath' | 'trim' | 'beatgrid'
>

// Serializes the fields that determine the converted output. A snapshot is taken
// when a track finishes (processedSignature); when the live values diverge from
// it the track is "stale" — the file on disk no longer matches the editor, so the
// convert button returns as "Update" to write the edit.
export function trackSignature(track: SignatureFields): string {
  return JSON.stringify([
    track.meta,
    track.outputName ?? '',
    track.coverUrl ?? '',
    track.coverPath ?? '',
    // Normalized so a trim with an unset bound and an absent trim read identically.
    track.trim ? [track.trim.startSec ?? null, track.trim.endSec ?? null] : null,
    track.beatgrid ? [track.beatgrid.bpm, track.beatgrid.anchorSec] : null,
  ])
}

// Only a done track can be stale: idle/processing/error already show a convert
// button. A done track with no snapshot (shouldn't happen) is treated as fresh.
export function isStale(track: TrackItem): boolean {
  return (
    track.status === 'done' &&
    track.processedSignature !== undefined &&
    track.processedSignature !== trackSignature(track)
  )
}

// Only the knobs the active mode actually applies: the other mode's numbers are
// inert, so touching them must not flag an update the export wouldn't change.
function normalizeEffect(cfg: NormalizeConfig): string {
  if (cfg.mode === 'loudness') return `loudness ${cfg.targetLufs} ${cfg.truePeakDb}`
  // The booleans coerced so a config saved before the options existed (undefined)
  // reads identically to one with them off.
  if (cfg.mode === 'peak')
    return `peak ${cfg.peakDb} ${!!cfg.peakRemoveDc} ${!!cfg.peakPerChannel}`
  return 'none'
}

// The normalization half of staleness: dialing a different target after an export
// must bring the Update button back exactly like a metadata edit — re-normalizing
// must not require touching a tag first. Compared against the editor's live dial
// (which isStale can't see), so the editor passes it in. A track converted before
// the applied config was recorded is treated as fresh, like the missing-snapshot
// case above.
export function isNormalizeStale(track: TrackItem, current: NormalizeConfig): boolean {
  return (
    track.status === 'done' &&
    track.processedNormalize !== undefined &&
    normalizeEffect(track.processedNormalize) !== normalizeEffect(current)
  )
}

// The click-repair half of staleness, same contract as isNormalizeStale: switching
// the intensity after an export must bring the Update button back, and a track
// converted before the applied mode was recorded is treated as fresh.
export function isDeclickStale(track: TrackItem, current: DeclickMode): boolean {
  return (
    track.status === 'done' &&
    track.processedDeclick !== undefined &&
    track.processedDeclick !== current
  )
}
