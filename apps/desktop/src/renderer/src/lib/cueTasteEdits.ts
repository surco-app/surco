import type { QueryClient } from '@tanstack/react-query'
import type { DropInput } from '../../../shared/dropDetect'
import { tasteTrackOf } from '../../../shared/dropTaste'
import { isEngineContent } from '../../../shared/engineContent'
import { isTraktorContent } from '../../../shared/traktorContent'
import type { TrackCues } from '../../../shared/types'
import { cueDropInputQuery, cueWaveDetailQuery, trackCuesQuery } from '../hooks/useTrackCues'
import { type CueDraft, draftDrops } from './cueDraft'

function inputOf(client: QueryClient, contentId: string): DropInput | null {
  if (isEngineContent(contentId) || isTraktorContent(contentId))
    return client.getQueryData<DropInput | null>(cueDropInputQuery(contentId).queryKey) ?? null
  const read = client.getQueryData<TrackCues | null>(trackCuesQuery(contentId).queryKey)
  const words = client.getQueryData<Uint16Array | null>(cueWaveDetailQuery(contentId).queryKey)
  return read && words ? { grid: read.grid, phrases: read.phrases, words } : null
}

export function recordCueEdits(
  client: QueryClient,
  saved: { contentId: string; draft: CueDraft }[],
): void {
  for (const { contentId, draft } of saved) {
    const input = inputOf(client, contentId)
    const track = input && tasteTrackOf(contentId, input, draftDrops(draft.cues, draft.locked))
    if (track)
      window.api.recordCueEdit(track).catch((e: unknown) => {
        window.api.logError(
          `cue taste: recording an edit failed (${e instanceof Error ? e.message : String(e)})`,
        )
      })
  }
}
