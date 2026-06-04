import type { TrackItem } from '../types'

// Whether hovering a track should warm its spectrogram. The editor computes the
// spectrum on open; prefetching it on hover hides that latency — but only when
// the feature is enabled and the track has none yet, so we never spawn ffmpeg for
// work already done or switched off.
export function needsSpectrum(track: TrackItem, showSpectrum: boolean): boolean {
  return showSpectrum && !track.spectrum
}
