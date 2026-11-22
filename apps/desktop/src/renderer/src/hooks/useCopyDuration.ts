import { useQuery } from '@tanstack/react-query'
import { analysisOptions } from '../lib/analysisQueries'
import type { CopyFacts } from '../lib/bestCopy'

export function copyDurationOptions(path: string) {
  return analysisOptions(
    'duration',
    path,
    (): Promise<number | null> => window.api.readDuration(path),
  )
}

export function useCopyDuration(path: string, enabled: boolean): number | null | undefined {
  const { data, isPending } = useQuery({ ...copyDurationOptions(path), enabled: enabled && !!path })
  return isPending ? undefined : (data ?? null)
}

export function withDuration(
  facts: CopyFacts | null | undefined,
  durationSec: number | null | undefined,
): CopyFacts | null | undefined {
  if (facts === undefined || durationSec === undefined) return undefined
  if (facts === null || durationSec === null) return facts
  return { ...facts, durationSec }
}
