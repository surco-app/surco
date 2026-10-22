import type { QueryClient } from '@tanstack/react-query'
import { queuedCuesQuery, trackCuesQuery } from '../hooks/useTrackCues'
import { cueDraftKey, forgetDraft, keptDraft, unsavedCueTracks } from './cueSession'

export async function forgetStaleDrafts(client: QueryClient): Promise<void> {
  for (const contentId of unsavedCueTracks()) {
    const [read, queued] = await Promise.all([
      client.fetchQuery({ ...trackCuesQuery(contentId), staleTime: 0 }).catch(() => null),
      client.fetchQuery({ ...queuedCuesQuery(contentId), staleTime: 0 }),
    ])
    if (!read || !keptDraft(contentId, cueDraftKey(contentId, read.fingerprint, queued)))
      forgetDraft(contentId)
  }
}
