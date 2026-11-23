import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { DjProgram } from '../../../shared/djProgram'
import type { ReplacedEntry } from '../../../shared/toReview'

export const REPLACED_QUERY = ['replaced-tracks'] as const

export function useReplacedTracks(): ReplacedEntry[] {
  const { data } = useQuery({
    queryKey: REPLACED_QUERY,
    queryFn: () => window.api.replacedTracks(),
    staleTime: Number.POSITIVE_INFINITY,
  })
  return data ?? []
}

export function useReviewReplaced(): {
  review: (path: string, programs?: DjProgram[]) => Promise<ReplacedEntry | null>
  restore: (entry: ReplacedEntry) => Promise<void>
} {
  const queryClient = useQueryClient()
  return {
    review: async (path, programs) => {
      const entry = await window.api.reviewReplaced(path, programs)
      await queryClient.invalidateQueries({ queryKey: REPLACED_QUERY })
      return entry
    },
    restore: async (entry) => {
      await window.api.restoreReplaced(entry)
      await queryClient.invalidateQueries({ queryKey: REPLACED_QUERY })
    },
  }
}
