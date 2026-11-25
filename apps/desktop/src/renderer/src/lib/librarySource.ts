import type { Settings } from '../../../shared/types'
import type { TrackItem } from '../types'
import { type AppleMusicIndex, isInLibrary } from './appleMusicLibrary'
import { toDestination } from './destination'

// Which library the "already owned" membership check reads. A conversion that lands in
// Apple Music checks Apple Music, even with Engine DJ on, so an upgrade can still offer to
// replace the Music copy; otherwise, with Engine DJ on, every conversion is registered in
// the Engine database, so that is the one checked. Folder/beside/overwrite conversions
// without Engine land in no library, so there is nothing meaningful to check and every
// membership surface hides.
export type LibrarySource = 'appleMusic' | 'engineDj' | null

export function librarySourceOf(
  settings: Pick<
    Settings,
    | 'addToAppleMusic'
    | 'addToEngineDj'
    | 'overwriteOriginal'
    | 'convertBesideOriginal'
    | 'outputFormat'
  > | null,
  mac: boolean,
): LibrarySource {
  if (!settings) return null
  const destination = toDestination(
    settings.addToAppleMusic,
    settings.outputFormat === 'flac',
    settings.overwriteOriginal,
    settings.convertBesideOriginal,
  )
  // Engine DJ's database is plain SQLite on every platform; the Apple Music bridge
  // only exists on macOS.
  if (destination === 'appleMusic' && mac) return 'appleMusic'
  if (settings.addToEngineDj) return 'engineDj'
  return null
}

// Whether that library already owns the track, read from the track's own record first (an
// add Surco made, or a verdict pinned earlier) and from the session snapshot otherwise.
// 'idle' while there is no library to ask or its snapshot has not landed, so nothing is
// claimed either way. A selection asks this per track; the open track's hook adds the
// Discogs-proven verdict on top.
export function libraryMembership(
  track: Pick<
    TrackItem,
    'meta' | 'duration' | 'musicPersistentId' | 'engineDjAdded' | 'inLibraryResolved'
  >,
  source: LibrarySource,
  index: AppleMusicIndex | null,
): 'idle' | 'yes' | 'no' {
  if (!source) return 'idle'
  const owned =
    source === 'appleMusic'
      ? track.musicPersistentId || track.inLibraryResolved
      : track.engineDjAdded || track.inLibraryResolved
  if (owned) return 'yes'
  if (!index) return 'idle'
  const ownTags = {
    title: track.meta.title,
    artist: track.meta.artist,
    durationSec: track.duration,
  }
  return isInLibrary(index, ownTags) ? 'yes' : 'no'
}
