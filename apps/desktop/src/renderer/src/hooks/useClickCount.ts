import { type UseQueryResult, useQuery } from '@tanstack/react-query'
import { analysisOptions } from '../lib/analysisQueries'

// Estimated audible clicks for the repair section's readout. Keyed by path like
// every probe, so revisiting a track never re-counts; gated on the section being
// open (the caller's `enabled`), so a folded section costs nothing. A failed
// estimate resolves null and the readout hides — never guesses.
export function useClickCount(inputPath: string, enabled: boolean): UseQueryResult<number | null> {
  return useQuery({
    ...analysisOptions('clicks', inputPath, () => window.api.clicks(inputPath)),
    enabled,
  })
}
