import type { QueryClient } from '@tanstack/react-query'
import { phraseCount } from '../../../shared/phraseCount'
import type { QueuedCues, TrackCues } from '../../../shared/types'
import { queuedCuesQuery, trackCuesQuery } from '../hooks/useTrackCues'

export async function phraseCountsOf(
  client: QueryClient,
  targets: { id: string; contentId: string }[],
): Promise<Map<string, string>> {
  const counts = new Map<string, string>()
  for (const { id, contentId } of targets) {
    const read =
      client.getQueryData<TrackCues | null>(trackCuesQuery(contentId).queryKey) ??
      (await window.api.cues.trackCues(contentId).catch(() => null))
    if (!read?.analysed) continue
    const queued =
      client.getQueryData<QueuedCues | null>(queuedCuesQuery(contentId).queryKey) ??
      (await queuedCuesQuery(contentId).queryFn())
    const count = phraseCount(queued?.wanted ?? read.cues, read.grid)
    if (count !== null) counts.set(id, count)
  }
  return counts
}
