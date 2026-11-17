import type { QueryClient } from '@tanstack/react-query'
import { queuedCuesQuery } from '../hooks/useTrackCues'
import { forgetDrafts, keptDraftOn, unsavedCueTracks } from './cueSession'
import { liveCuesOf } from './liveCuesOf'

const QUEUED_CHUNK = 500

export async function forgetStaleDrafts(client: QueryClient): Promise<void> {
  const contentIds = [...unsavedCueTracks()]
  const { reads, failed } = await liveCuesOf(contentIds)
  const stale: string[] = []
  const readable = contentIds.filter((contentId) => !failed.has(contentId))
  for (let i = 0; i < readable.length; i += QUEUED_CHUNK) {
    const chunk = readable.slice(i, i + QUEUED_CHUNK)
    const queued = await Promise.all(
      chunk.map((contentId) => client.fetchQuery({ ...queuedCuesQuery(contentId), staleTime: 0 })),
    )
    chunk.forEach((contentId, at) => {
      const read = reads[contentId]
      if (!read || !keptDraftOn(contentId, read, queued[at])) stale.push(contentId)
    })
  }
  forgetDrafts(stale)
}
