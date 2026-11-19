import type { QueryClient } from '@tanstack/react-query'
import type { CueProfileRead } from '../../../shared/cueProfile'
import type { DropInput } from '../../../shared/dropDetect'
import { modelWithTaste, tasteTrackOf } from '../../../shared/dropTaste'
import type { TrackCues } from '../../../shared/types'
import {
  cueDropInputQuery,
  cueProfileQuery,
  cueWaveDetailQuery,
  trackCuesQuery,
} from '../hooks/useTrackCues'
import { type CueDraft, draftDrops } from './cueDraft'
import { cueProgramOf } from './cuePrograms'

async function inputOf(client: QueryClient, contentId: string): Promise<DropInput | null> {
  if (cueProgramOf(contentId).readsAudio) return client.fetchQuery(cueDropInputQuery(contentId))
  const [read, words] = await Promise.all([
    client.fetchQuery(trackCuesQuery(contentId)),
    client.fetchQuery(cueWaveDetailQuery(contentId)),
  ])
  return read && words ? { grid: read.grid, phrases: read.phrases, words } : null
}

const tasteOf = (client: QueryClient) =>
  client.getQueryData<CueProfileRead>(cueProfileQuery.queryKey)?.profile?.taste ?? null

export async function recordCueEdits(
  client: QueryClient,
  saved: { contentId: string; draft: CueDraft }[],
): Promise<void> {
  const taste = tasteOf(client)
  await Promise.all(
    saved.map(async ({ contentId, draft }) => {
      const drops = draftDrops(draft.cues, draft.locked)
      if (drops.length === 0) return
      try {
        const input = await inputOf(client, contentId)
        const track = input && tasteTrackOf(input, drops, modelWithTaste(taste))
        if (track) await window.api.recordCueEdit(track)
      } catch (e: unknown) {
        window.api.logError(
          `cue taste: recording an edit failed (${e instanceof Error ? e.message : String(e)})`,
        )
      }
    }),
  )
}
