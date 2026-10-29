import type { Settings } from '../../../shared/types'
import { toDestination } from './destination'

// Which library the "already owned" membership check reads. With Engine DJ on, a
// conversion that produces a fresh copy checks the Engine database; otherwise one that
// lands in Apple Music checks Apple Music. Beside/overwrite conversions and a plain
// folder one land in no library, so there is nothing meaningful to check and every
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
  if (settings.addToEngineDj && destination !== 'overwrite' && destination !== 'beside')
    return 'engineDj'
  if (destination === 'appleMusic' && mac) return 'appleMusic'
  return null
}
