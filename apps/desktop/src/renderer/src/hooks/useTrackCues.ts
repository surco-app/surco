import { useQuery } from '@tanstack/react-query'
import type { WantedCue } from '../../../shared/cueRules'
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

export function useQueuedCues(contentId: string): { data: WantedCue[] | null | undefined } {
  const { data } = useQuery({
    queryKey: ['rekordbox-queued-cues', contentId],
    queryFn: () =>
      window.api.rekordboxQueuedCues(contentId).catch((e: unknown) => {
        window.api.logError(
          `rekordbox cues: queued save unreadable (${e instanceof Error ? e.message : String(e)})`,
        )
        return null
      }),
    staleTime: Number.POSITIVE_INFINITY,
  })
  return { data }
}
