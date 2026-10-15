import { queryOptions, useQueries, useQuery } from '@tanstack/react-query'
import type { LoudnessResult, PairFacts, SpectrumVerdict } from '../../../shared/types'
import { analysisOptions } from '../lib/analysisQueries'
import type { CopyFacts } from '../lib/bestCopy'
import { fileExtension } from '../lib/properties'
import { spectrogramOptions } from './useSpectrogram'

// Not an ANALYSIS_QUERY_KEYS family: that eviction matches [family, path], and a pair key
// carries two paths, so it would only ever match the first. The pair result stays for the
// session; it is a few numbers.
// Both directions share one entry, called in sorted order. gainDb is relative to the first
// path of the sorted pair; only |gainDb| is consumed, so the direction does not matter.
export function pairOptions(a: string, b: string) {
  const [first, second] = [a, b].sort()
  return queryOptions({
    queryKey: ['pair', first, second],
    queryFn: () => window.api.comparePair(first, second),
    staleTime: Number.POSITIVE_INFINITY,
  })
}

export function usePairFacts(a: string, b: string, enabled: boolean): PairFacts | null | undefined {
  const query = useQuery({ ...pairOptions(a, b), enabled: enabled && !!a && !!b })
  return query.isPending ? undefined : (query.data ?? null)
}

export function copyFactsQueries(path: string) {
  return [
    spectrogramOptions(path, 'low'),
    analysisOptions('loudness', path, () => window.api.loudness(path, 'low')),
    analysisOptions('fingerprint', path, () => window.api.fingerprint(path, 'low')),
  ] as const
}

// A spectrum without a cutoff means that probe failed, and no decision is allowed on a
// copy we could not measure.
export function toCopyFacts(
  path: string,
  spectrum: SpectrumVerdict | undefined,
  loud: LoudnessResult | null | undefined,
  fingerprint: string | null | undefined,
): CopyFacts | null {
  if (!spectrum || spectrum.cutoffHz === null || !loud || !fingerprint) return null
  return {
    ext: fileExtension(path),
    cutoffHz: spectrum.cutoffHz,
    hasKnee: spectrum.hasKnee,
    processed: spectrum.processed,
    upsampled: spectrum.upsampled,
    fingerprint,
    peakCount: loud.peakCount ?? null,
    crestDb: loud.crestDb,
    integratedLufs: loud.integratedLufs,
  }
}

export function useCopyFacts(path: string, enabled: boolean): CopyFacts | null | undefined {
  const [spectrum, loud, fp] = useQueries({
    queries: copyFactsQueries(path).map((q) => ({ ...q, enabled: enabled && !!path })),
  })
  if (!enabled || !path || spectrum.isPending || loud.isPending || fp.isPending) return undefined
  return toCopyFacts(
    path,
    spectrum.data as SpectrumVerdict | undefined,
    loud.data as LoudnessResult | null | undefined,
    fp.data as string | null | undefined,
  )
}
