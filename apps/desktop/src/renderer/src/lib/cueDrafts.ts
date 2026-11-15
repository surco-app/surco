import type { QueryClient } from '@tanstack/react-query'
import { queuedCuesQuery } from '../hooks/useTrackCues'
import { forgetDrafts, keptDraftOn, unsavedCueTracks } from './cueSession'
import { liveCuesOf } from './liveCuesOf'

export async function forgetStaleDrafts(client: QueryClient): Promise<void> {
  const contentIds = [...unsavedCueTracks()]
  const { reads, failed } = await liveCuesOf(contentIds)
  const stale: string[] = []
  for (const contentId of contentIds) {
    if (failed.has(contentId)) continue
    const queued = await client.fetchQuery({ ...queuedCuesQuery(contentId), staleTime: 0 })
    const read = reads[contentId]
    if (!read || !keptDraftOn(contentId, read, queued)) stale.push(contentId)
  }
  forgetDrafts(stale)
}
