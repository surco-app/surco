import { type UseQueryResult, useQuery } from '@tanstack/react-query'
import type { WaveformResult, WaveformScan } from '../../../shared/types'
import { analysisOptions, cancellableAnalysisOptions } from '../lib/analysisQueries'

// The one definition of a waveform cache entry, shared by the player's strip and the
// hover prefetch so a single drifting key can't fork the cache. Keyed by path so
// revisiting a track re-reads the disk cache instead of re-decoding the entire file.
// The priority rides into the analysis limiter (not the cache key, like spectrogramOptions):
// the player asks 'urgent' so its decode jumps ahead not just of a background sweep's 'low'
// floods but of the selected track's OWN 'high' passes (spectrum/shelf/loudness), which
// otherwise queue ahead of the wave the DJ is staring at. The cache it fills is the same
// one regardless, so a warmed 'low' entry serves the player with no re-decode. Foreground
// (urgent/high) requests are cancellable: playing the next track aborts the previous one's
// full-length decode instead of finishing it.
export function waveformOptions(inputPath: string, priority: 'urgent' | 'high' | 'low' = 'low') {
  const probe = (): Promise<WaveformResult | null> => window.api.waveform(inputPath, priority)
  return priority === 'low'
    ? analysisOptions('waveform', inputPath, probe)
    : cancellableAnalysisOptions('waveform', inputPath, probe)
}

// Whole-track peak envelope for the player's waveform strip. Disabled until there's a
// track to draw — this is the only analysis that decodes the full length, so it must
// not run for a track with no duration yet.
export function useWaveform(
  inputPath: string,
  enabled: boolean,
): UseQueryResult<WaveformResult | null> {
  // The player mounts this for the track the user just hit play on — the one decode they're
  // actively waiting on — so it asks 'urgent' to preempt both a background sweep's 'low'
  // decodes and the selected track's own 'high' passes (spectrum/shelf/loudness).
  return useQuery({ ...waveformOptions(inputPath, 'urgent'), enabled })
}

// The native-rate clip/channel scan for the compare/player strip only — a separate,
// heavier probe from the peaks above, so the editor sections that draw just the envelope
// (trim, declick) never trigger it. Its own cache entry, always complete for its
// own contract, so the peaks-only wave is never starved of marks and vice versa.
export function waveformScanOptions(inputPath: string) {
  return analysisOptions('waveformScan', inputPath, () => window.api.waveformScan(inputPath))
}

export function useWaveformScan(
  inputPath: string,
  enabled: boolean,
): UseQueryResult<WaveformScan | null> {
  return useQuery({ ...waveformScanOptions(inputPath), enabled })
}
