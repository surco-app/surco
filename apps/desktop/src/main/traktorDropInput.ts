import type { DropInput } from '../shared/dropDetect'
import { traktorKey } from '../shared/traktorContent'
import { type EngineDropSources, rekordboxInput } from './engineDropInput'
import { readTraktorTrackCues, traktorEntryBlock } from './traktorCues'
import { traktorFileOf } from './traktorPlaylists'

export interface TraktorDropSources extends Omit<EngineDropSources, 'libraryDir'> {
  nml: string
  bootVolume: string
}

// Traktor keeps no phrases, so Auto mark detects as it does for Engine DJ: on rekordbox's
// analysis when rekordbox has the same file, otherwise on Surco's own words over
// Traktor's grid.
export async function traktorDropInput(
  contentId: string,
  sources: TraktorDropSources,
): Promise<DropInput | null> {
  const key = traktorKey(contentId)
  const entry = key === null ? null : traktorEntryBlock(sources.nml, key)
  const read = entry && readTraktorTrackCues(sources.nml, contentId)
  if (!entry || !read?.analysed) return null
  const file = traktorFileOf(entry.block, sources.bootVolume)
  const fromRekordbox = rekordboxInput(file, sources)
  if (fromRekordbox) return fromRekordbox
  const words = await sources.words(file)
  return words ? { grid: read.grid, phrases: [], words } : null
}
