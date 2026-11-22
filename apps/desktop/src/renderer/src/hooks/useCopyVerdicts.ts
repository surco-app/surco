import { useQueries } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type {
  LoudnessResult,
  PairFacts,
  SpectrumVerdict,
  TrackProperties,
} from '../../../shared/types'
import { type CopyFacts, type CopyVerdict, compareCopies } from '../lib/bestCopy'
import { libraryCopyFormat } from '../lib/properties'
import { copyDurationOptions } from './useCopyDuration'
import { copyFactsQueries, pairOptions, toCopyFacts } from './useCopyFacts'
import { trackPropertiesOptions } from './useTrackProperties'

export interface CopyVerdictState {
  verdict: CopyVerdict | null
  measuring: boolean
  format: string
  here?: CopyFacts
  copy?: CopyFacts
  durationSec?: number
}

const FACTS_PER_FILE = 3
const QUERIES_PER_COPY = FACTS_PER_FILE + 3

type Settled<T> = { isPending: boolean; data: T | undefined }

function factsFrom(path: string, results: Settled<unknown>[]): CopyFacts | null | undefined {
  if (results.some((result) => result.isPending)) return undefined
  return toCopyFacts(
    path,
    results[0].data as SpectrumVerdict | undefined,
    results[1].data as LoudnessResult | null | undefined,
    results[2].data as string | null | undefined,
  )
}

export function useCopyVerdicts(herePath: string, copyPaths: string[]): CopyVerdictState[] {
  const { i18n } = useTranslation()
  const on = copyPaths.length > 0 && !!herePath
  const results = useQueries({
    queries: [
      ...copyFactsQueries(herePath, 'high').map((query) => ({ ...query, enabled: on })),
      ...copyPaths.flatMap((path) => [
        ...copyFactsQueries(path).map((query) => ({ ...query, enabled: on && !!path })),
        { ...pairOptions(herePath, path), enabled: on && !!path },
        { ...trackPropertiesOptions(path), enabled: !!path },
        { ...copyDurationOptions(path), enabled: on && !!path },
      ]),
    ],
  }) as Settled<unknown>[]

  if (copyPaths.length === 0) return []
  const here = factsFrom(herePath, results.slice(0, FACTS_PER_FILE))
  return copyPaths.map((path, i) => {
    const start = FACTS_PER_FILE + i * QUERIES_PER_COPY
    const copy = factsFrom(path, results.slice(start, start + FACTS_PER_FILE))
    const pairResult = results[start + FACTS_PER_FILE]
    const pair = pairResult.isPending ? undefined : ((pairResult.data as PairFacts | null) ?? null)
    const props = results[start + FACTS_PER_FILE + 1].data as TrackProperties | null | undefined
    const format = props ? libraryCopyFormat(props, path, i18n.language) : ''
    const durationResult = results[start + FACTS_PER_FILE + 2]
    const measuring =
      here === undefined || copy === undefined || pair === undefined || durationResult.isPending
    const verdict = here && copy && pair !== undefined ? compareCopies(here, copy, pair) : null
    return {
      verdict,
      measuring,
      format,
      here: here ?? undefined,
      copy: copy ?? undefined,
      durationSec: (durationResult.data as number | null | undefined) ?? undefined,
    }
  })
}
