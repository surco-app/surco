import {
  type QueryClient,
  queryOptions,
  type UseQueryResult,
  useQueries,
  useQueryClient,
} from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { trackPropertiesOptions } from './useTrackProperties'

export interface CopyReach {
  missing: boolean
  unreadable: boolean
  // A failed probe the file check and the second read have not settled yet: neither answer
  // is known, so the row says it is still comparing.
  checking: boolean
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

// The paths already read a second time in this client's session: whether a failure is the
// second one is a fact to keep, not to infer from clock readings that can tie.
const reread = new WeakMap<QueryClient, Set<string>>()
const inFlight = new WeakMap<QueryClient, Set<string>>()

function pathsOf(book: WeakMap<QueryClient, Set<string>>, queryClient: QueryClient): Set<string> {
  const known = book.get(queryClient) ?? new Set<string>()
  book.set(queryClient, known)
  return known
}

export function useCopyReach(copies: CopyProbe[]): CopyReach[] {
  const queryClient = useQueryClient()
  const [, settle] = useState(0)
  const exists = useQueries({
    queries: copies.map(({ path, properties }) => ({
      ...fileExistsOptions(path),
      enabled: !!path && probeFailed(properties),
    })),
  })
  const reach = copies.map(({ path, properties }, i) => {
    const failed = probeFailed(properties) && !properties.isFetching
    const there = exists[i].isError ? true : exists[i].data
    const outdated = there === true && !pathsOf(reread, queryClient).has(path)
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
      const running = pathsOf(inFlight, queryClient)
      if (running.has(path)) continue
      running.add(path)
      void queryClient
        .invalidateQueries({ queryKey: trackPropertiesOptions(path).queryKey, exact: true })
        .then(() => pathsOf(reread, queryClient).add(path))
        .finally(() => {
          running.delete(path)
          settle((n) => n + 1)
        })
    }
  }, [queryClient, outdatedPaths])
  return reach.map(({ missing, unreadable }, i) => ({
    missing,
    unreadable,
    checking: probeFailed(copies[i].properties) && !missing && !unreadable,
  }))
}
