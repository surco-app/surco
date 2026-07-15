import { type UseQueryResult, useQuery } from '@tanstack/react-query'
import type { WaveformResult, WaveformScan } from '../../../shared/types'
import { analysisOptions } from '../lib/analysisQueries'

// The one definition of a waveform cache entry, shared by the player's strip and the
// hover prefetch so a single drifting key can't fork the cache. Keyed by path so
// revisiting a track re-reads the disk cache instead of re-decoding the entire file.
export function waveformOptions(inputPath: string) {
  return analysisOptions('waveform', inputPath, () => window.api.waveform(inputPath))
}

// Whole-track peak envelope for the player's waveform strip. Disabled until there's a
// track to draw — this is the only analysis that decodes the full length, so it must
// not run for a track with no duration yet.
export function useWaveform(
  inputPath: string,
  enabled: boolean,
): UseQueryResult<WaveformResult | null> {
  return useQuery({ ...waveformOptions(inputPath), enabled })
}

// The native-rate clip/channel scan for the compare/player strip only — a separate,
// heavier probe from the peaks above, so the editor sections that draw just the envelope
// (trim, grid, declick) never trigger it. Its own cache entry, always complete for its
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
