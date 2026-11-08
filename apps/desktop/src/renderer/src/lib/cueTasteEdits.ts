import type { QueryClient } from '@tanstack/react-query'
import type { CueProfileRead } from '../../../shared/cueProfile'
import type { DropInput } from '../../../shared/dropDetect'
import { modelWithTaste, type TasteOutcome, tasteTrackOf } from '../../../shared/dropTaste'
import type { TrackCues } from '../../../shared/types'
import {
  cueDropInputQuery,
  cueProfileQuery,
  cueWaveDetailQuery,
  trackCuesQuery,
} from '../hooks/useTrackCues'
import { type CueDraft, draftDrops } from './cueDraft'
import { cueProgramOf } from './cuePrograms'

function inputOf(client: QueryClient, contentId: string): DropInput | null {
  if (cueProgramOf(contentId).readsAudio)
    return client.getQueryData<DropInput | null>(cueDropInputQuery(contentId).queryKey) ?? null
  const read = client.getQueryData<TrackCues | null>(trackCuesQuery(contentId).queryKey)
  const words = client.getQueryData<Uint16Array | null>(cueWaveDetailQuery(contentId).queryKey)
  return read && words ? { grid: read.grid, phrases: read.phrases, words } : null
}

const tasteOf = (client: QueryClient) =>
  client.getQueryData<CueProfileRead>(cueProfileQuery.queryKey)?.profile?.taste ?? null

export function cueOutcomeOf(
  client: QueryClient,
  contentId: string,
  draft: Pick<CueDraft, 'cues' | 'locked'>,
): TasteOutcome | null {
  const input = inputOf(client, contentId)
  const track =
    input &&
    tasteTrackOf(input, draftDrops(draft.cues, draft.locked), modelWithTaste(tasteOf(client)))
  return track?.outcome ?? null
}

export function recordCueEdits(
  client: QueryClient,
  saved: { contentId: string; draft: CueDraft }[],
): void {
  const taste = tasteOf(client)
  for (const { contentId, draft } of saved) {
    const input = inputOf(client, contentId)
    const track =
      input && tasteTrackOf(input, draftDrops(draft.cues, draft.locked), modelWithTaste(taste))
    if (track)
      window.api.recordCueEdit(track).catch((e: unknown) => {
        window.api.logError(
          `cue taste: recording an edit failed (${e instanceof Error ? e.message : String(e)})`,
        )
      })
  }
}
