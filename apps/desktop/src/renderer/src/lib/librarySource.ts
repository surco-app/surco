import type { Settings } from '../../../shared/types'
import { toDestination } from './destination'

// Which library the "already owned" membership check reads: the destination's. A
// conversion that lands in Apple Music checks Apple Music; one that lands in Engine DJ
// checks the Engine database; folder/overwrite conversions land in no library, so
// there is nothing meaningful to check and every membership surface hides.
export type LibrarySource = 'appleMusic' | 'engineDj' | null

export function librarySourceOf(
  settings: Pick<
    Settings,
    'addToAppleMusic' | 'addToEngineDj' | 'overwriteOriginal' | 'outputFormat'
  > | null,
  mac: boolean,
): LibrarySource {
  if (!settings) return null
  const destination = toDestination(
    settings.addToAppleMusic,
    settings.outputFormat === 'flac',
    settings.overwriteOriginal,
    settings.addToEngineDj,
  )
  // Engine DJ's database is plain SQLite on every platform; the Apple Music bridge
  // only exists on macOS.
  if (destination === 'engineDj') return 'engineDj'
  if (destination === 'appleMusic' && mac) return 'appleMusic'
  return null
}
