import type { TrackItem } from '../types'

type SignatureFields = Pick<TrackItem, 'meta' | 'outputName' | 'coverUrl' | 'coverPath'>

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
