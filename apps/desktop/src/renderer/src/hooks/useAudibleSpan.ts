import { queryOptions, useQuery } from '@tanstack/react-query'
import type { WaveformResult } from '../../../shared/types'
import type { CopyFacts } from '../lib/bestCopy'
import { type GatedWave, pairOnsets, trimThresholdDb } from '../lib/trim'
import { waveformOptions } from './useWaveform'

// A module-level select, so React Query keeps its result for as long as the waveform does:
// an arrow built per call ran the gate's sort over every peak on each Editor render.
function gatedWave(wave: WaveformResult | null): GatedWave | null {
  return wave ? { wave, gateDb: trimThresholdDb(wave.peaks) } : null
}

// The silence at either end of a copy, as the trim section detects it on the same waveform
// entry: a full decode on a cold cache, which the comparison asks for only when the gap
// between two lengths may be all silence (wantsAudibleSpans).
export function gatedWaveOptions(path: string) {
  return queryOptions({ ...waveformOptions(path), select: gatedWave })
}

export function settledWave(result: {
  isPending: boolean
  data?: unknown
}): GatedWave | null | undefined {
  return result.isPending ? undefined : ((result.data as GatedWave | null | undefined) ?? null)
}

export function useGatedWave(path: string, enabled: boolean): GatedWave | null | undefined {
  const result = useQuery({ ...gatedWaveOptions(path), enabled: enabled && !!path })
  return enabled ? settledWave(result) : null
}

// Both copies' facts once the silence is in, when the pair needs it: until then both are
// still being measured, so nothing fills from a verdict about to change. The two are read at
// one gate (pairOnsets) so a padded copy and a bare one are measured alike.
export function withAudible(
  here: CopyFacts | null | undefined,
  copy: CopyFacts | null | undefined,
  hereWave: GatedWave | null | undefined,
  copyWave: GatedWave | null | undefined,
  wanted: boolean,
): [CopyFacts | null | undefined, CopyFacts | null | undefined] {
  if (!wanted || !here || !copy) return [here, copy]
  if (hereWave === undefined || copyWave === undefined) return [undefined, undefined]
  if (!hereWave || !copyWave) return [here, copy]
  const [hereSpan, copySpan] = pairOnsets(hereWave, copyWave)
  return [
    hereSpan ? { ...here, audible: hereSpan } : here,
    copySpan ? { ...copy, audible: copySpan } : copy,
  ]
}
