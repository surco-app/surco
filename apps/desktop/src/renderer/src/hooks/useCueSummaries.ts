import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import type { CueSummary } from '../../../shared/types'

const NONE: Record<string, CueSummary> = {}
const CUE_SUMMARY_DEBOUNCE_MS = 1000

export function useCueSummaries(
  contentIds: string[],
  enabled: boolean,
): Record<string, CueSummary> {
  const sorted = useMemo(
    () => (enabled ? [...new Set(contentIds)].sort() : []),
    [contentIds, enabled],
  )
  const [key, setKey] = useState(sorted)
  useEffect(() => {
    const timer = setTimeout(() => setKey(sorted), CUE_SUMMARY_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [sorted])
  const { data } = useQuery({
    queryKey: ['rekordbox-cue-summary', key],
    queryFn: () => window.api.rekordboxCueSummary(key),
    enabled: enabled && key.length > 0,
    staleTime: Number.POSITIVE_INFINITY,
    placeholderData: keepPreviousData,
  })
  return data ?? NONE
}
