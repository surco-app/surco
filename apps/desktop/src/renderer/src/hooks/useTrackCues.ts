import { useQuery } from '@tanstack/react-query'
import type { TrackCues } from '../../../shared/types'

export function useTrackCues(contentId: string | undefined): {
  data: TrackCues | null | undefined
  isError: boolean
} {
  const { data, isError } = useQuery({
    queryKey: ['rekordbox-track-cues', contentId],
    queryFn: () => window.api.rekordboxTrackCues(contentId as string),
    enabled: contentId !== undefined,
    staleTime: Number.POSITIVE_INFINITY,
  })
  return { data, isError }
}
