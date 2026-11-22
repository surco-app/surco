import {
  queryOptions,
  type UseQueryResult,
  useQueries,
  useQueryClient,
} from '@tanstack/react-query'
import { useEffect } from 'react'
import { trackPropertiesOptions } from './useTrackProperties'

export interface CopyReach {
  missing: boolean
  unreadable: boolean
}

export type PropertiesResult = Pick<
  UseQueryResult<unknown>,
  'isPending' | 'isError' | 'isFetching' | 'data' | 'dataUpdatedAt' | 'errorUpdatedAt'
>

export interface CopyProbe {
  path: string
  properties: PropertiesResult
}

const FILE_EXISTS_STALE_MS = 60_000

export function fileExistsOptions(path: string) {
  return queryOptions({
    queryKey: ['file-exists', path],
    queryFn: () => window.api.fileExists(path),
    staleTime: FILE_EXISTS_STALE_MS,
  })
}

function probeFailed(properties: PropertiesResult): boolean {
  return !properties.isPending && (properties.isError || properties.data === null)
}

export function useCopyReach(copies: CopyProbe[]): CopyReach[] {
  const queryClient = useQueryClient()
  const exists = useQueries({
    queries: copies.map(({ path, properties }) => ({
      ...fileExistsOptions(path),
      enabled: !!path && probeFailed(properties),
    })),
  })
  const reach = copies.map(({ path, properties }, i) => {
    const failed = probeFailed(properties) && !properties.isFetching
    const there = exists[i].data
    const probedAt = Math.max(properties.dataUpdatedAt, properties.errorUpdatedAt)
    const outdated = there === true && probedAt < exists[i].dataUpdatedAt
    return {
      path,
      outdated: failed && outdated,
      missing: failed && there === false,
      unreadable: failed && there === true && !outdated,
    }
  })
  const outdatedPaths = reach
    .filter((copy) => copy.outdated)
    .map((copy) => copy.path)
    .join('\n')
  useEffect(() => {
    if (!outdatedPaths) return
    for (const path of outdatedPaths.split('\n')) {
      void queryClient.invalidateQueries({
        queryKey: trackPropertiesOptions(path).queryKey,
        exact: true,
      })
    }
  }, [queryClient, outdatedPaths])
  return reach.map(({ missing, unreadable }) => ({ missing, unreadable }))
}
