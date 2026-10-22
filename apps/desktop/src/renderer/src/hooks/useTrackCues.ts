import { useQuery } from '@tanstack/react-query'
import type { QueuedCues, TrackCues } from '../../../shared/types'

export const trackCuesQuery = (contentId: string) => ({
  queryKey: ['rekordbox-track-cues', contentId],
  queryFn: () => window.api.rekordboxTrackCues(contentId),
  staleTime: Number.POSITIVE_INFINITY,
})

export const queuedCuesQuery = (contentId: string) => ({
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

export const cueWaveDetailQuery = (contentId: string) => ({
  queryKey: ['rekordbox-cue-wave-detail', contentId],
  queryFn: () => window.api.rekordboxCueWaveDetail(contentId),
  staleTime: Number.POSITIVE_INFINITY,
})

export function useTrackCues(contentId: string | undefined): {
  data: TrackCues | null | undefined
  isError: boolean
} {
  const { data, isError } = useQuery({
    ...trackCuesQuery(contentId as string),
    enabled: contentId !== undefined,
  })
  return { data, isError }
}

export function useQueuedCues(contentId: string): { data: QueuedCues | null | undefined } {
  const { data } = useQuery(queuedCuesQuery(contentId))
  return { data }
}

export function useCueWaveDetail(
  contentId: string,
  enabled: boolean,
): { data: Uint16Array | null | undefined } {
  const { data } = useQuery({ ...cueWaveDetailQuery(contentId), enabled })
  return { data }
}
