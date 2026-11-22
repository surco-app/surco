import { useQueries } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type {
  LoudnessResult,
  PairProbe,
  SpectrumVerdict,
  TrackProperties,
} from '../../../shared/types'
import { type CopyFacts, type CopyVerdict, compareCopies } from '../lib/bestCopy'
import { libraryCopyFormat } from '../lib/properties'
import { copyDurationOptions, withDuration } from './useCopyDuration'
import { copyFactsQueries, toCopyFacts, versionPairOptions } from './useCopyFacts'
import { type PropertiesResult, useCopyReach } from './useCopyReach'
import { trackPropertiesOptions } from './useTrackProperties'

export interface CopyVerdictState {
  verdict: CopyVerdict | null
  measuring: boolean
  format: string
  missing: boolean
  unreadable: boolean
  checking: boolean
  here?: CopyFacts
  copy?: CopyFacts
}

const FACTS_PER_FILE = 3
const HERE_QUERIES = FACTS_PER_FILE + 1
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

function settledDuration(result: Settled<unknown>): number | null | undefined {
  return result.isPending ? undefined : ((result.data as number | null | undefined) ?? null)
}

export function useCopyVerdicts(herePath: string, copyPaths: string[]): CopyVerdictState[] {
  const { i18n } = useTranslation()
  const on = copyPaths.length > 0 && !!herePath
  const results = useQueries({
    queries: [
      ...copyFactsQueries(herePath, 'high').map((query) => ({ ...query, enabled: on })),
      { ...copyDurationOptions(herePath), enabled: on },
      ...copyPaths.flatMap((path) => [
        ...copyFactsQueries(path).map((query) => ({ ...query, enabled: on && !!path })),
        { ...copyDurationOptions(path), enabled: on && !!path },
        { ...versionPairOptions(herePath, path), enabled: on && !!path },
        { ...trackPropertiesOptions(path), enabled: !!path },
      ]),
    ],
  }) as (Settled<unknown> & PropertiesResult)[]
  const reach = useCopyReach(
    copyPaths.map((path, i) => ({
      path,
      properties: results[HERE_QUERIES + i * QUERIES_PER_COPY + FACTS_PER_FILE + 2],
    })),
  )

  if (copyPaths.length === 0) return []
  const here = withDuration(
    factsFrom(herePath, results.slice(0, FACTS_PER_FILE)),
    settledDuration(results[FACTS_PER_FILE]),
  )
  return copyPaths.map((path, i) => {
    const start = HERE_QUERIES + i * QUERIES_PER_COPY
    const copy = withDuration(
      factsFrom(path, results.slice(start, start + FACTS_PER_FILE)),
      settledDuration(results[start + FACTS_PER_FILE]),
    )
    const pairResult = results[start + FACTS_PER_FILE + 1]
    const pair = pairResult.isPending ? undefined : ((pairResult.data as PairProbe | null) ?? null)
    const props = results[start + FACTS_PER_FILE + 2].data as TrackProperties | null | undefined
    const format = props ? libraryCopyFormat(props, path, i18n.language) : ''
    const measuring = here === undefined || copy === undefined || pair === undefined
    const verdict = here && copy && pair !== undefined ? compareCopies(here, copy, pair) : null
    return {
      verdict,
      measuring,
      format,
      ...reach[i],
      here: here ?? undefined,
      copy: copy ?? undefined,
    }
  })
}
