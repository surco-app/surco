import { queryOptions, useQuery } from '@tanstack/react-query'
import type { WaveformResult } from '../../../shared/types'
import type { CopyFacts } from '../lib/bestCopy'
import { detectOnsets } from '../lib/trim'
import { waveformOptions } from './useWaveform'

type AudibleSpan = NonNullable<CopyFacts['audible']>

// The silence at either end of a copy, as the trim section detects it on the same waveform
// entry: a full decode on a cold cache, which the comparison asks for only when the gap
// between two lengths may be all silence (wantsAudibleSpans).
export function audibleSpanOptions(path: string) {
  return queryOptions({
    ...waveformOptions(path),
    select: (wave: WaveformResult | null): AudibleSpan | null =>
      (wave && detectOnsets(wave)) ?? null,
  })
}

export function settledSpan(result: {
  isPending: boolean
  data?: unknown
}): AudibleSpan | null | undefined {
  return result.isPending ? undefined : ((result.data as AudibleSpan | null | undefined) ?? null)
}

export function useAudibleSpan(path: string, enabled: boolean): AudibleSpan | null | undefined {
  const result = useQuery({ ...audibleSpanOptions(path), enabled: enabled && !!path })
  return enabled ? settledSpan(result) : null
}

// Facts for the comparison once the silence is in, when the pair needs it: until then the
// copy is still being measured, so nothing fills from a verdict about to change.
export function withAudible(
  facts: CopyFacts | null | undefined,
  span: AudibleSpan | null | undefined,
  wanted: boolean,
): CopyFacts | null | undefined {
  if (!wanted || !facts) return facts
  if (span === undefined) return undefined
  return span ? { ...facts, audible: span } : facts
}
