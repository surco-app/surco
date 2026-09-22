import type { Settings } from '../../../shared/types'

// Which library the "already owned" membership check reads: the destination's. A
// conversion that lands in Apple Music checks Apple Music; one that lands in Engine DJ
// checks the Engine database (also when it lands in both); a conversion that lands in
// no library has nothing meaningful to check and every membership surface hides.
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
  const inFolder = !settings.overwriteOriginal && !settings.convertBesideOriginal
  // Engine DJ's database is plain SQLite on every platform; the Apple Music bridge
  // only exists on macOS.
  if (inFolder && settings.addToEngineDj) return 'engineDj'
  if (inFolder && settings.addToAppleMusic && settings.outputFormat !== 'flac' && mac)
    return 'appleMusic'
  return null
}
