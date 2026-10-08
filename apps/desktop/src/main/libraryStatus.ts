import { join } from 'node:path'
import type { LibraryStatus } from '../shared/types'
import { findRekordboxCollection } from './rekordboxPath'

interface StatusSettings {
  syncRekordbox: boolean
  rekordboxDbPath: string
  syncEngineDj: boolean
  engineLibraryDir: string
  syncTraktor: boolean
  traktorNmlPath: string
}

// A toggle only grants permission; whether the library can be written is a separate
// question, because a configured path outlives the folder it pointed at. Told apart so
// the review can say "not found" instead of promising a sync that cannot happen.
export function libraryStatus(
  settings: StatusSettings,
  exists: (path: string) => boolean,
): LibraryStatus {
  const rekordboxPath = findRekordboxCollection({ configured: settings.rekordboxDbPath })
  return {
    rekordbox: {
      enabled: settings.syncRekordbox,
      found: rekordboxPath !== '' && exists(rekordboxPath),
    },
    engine: {
      enabled: settings.syncEngineDj,
      found: exists(join(settings.engineLibraryDir, 'Database2', 'm.db')),
    },
    traktor: {
      enabled: settings.syncTraktor,
      found: settings.traktorNmlPath !== '' && exists(settings.traktorNmlPath),
    },
  }
}
