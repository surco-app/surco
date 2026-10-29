import type { Settings } from '../../../shared/types'
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
