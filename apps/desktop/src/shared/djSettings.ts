import type { DjProgram } from './djProgram'

export const DJ_REACH_SETTINGS: Record<
  DjProgram,
  {
    sync: 'syncRekordbox' | 'syncTraktor' | 'syncEngineDj'
    add: 'addToRekordbox' | 'addToTraktor' | 'addToEngineDj'
  }
> = {
  rekordbox: { sync: 'syncRekordbox', add: 'addToRekordbox' },
  engine: { sync: 'syncEngineDj', add: 'addToEngineDj' },
  traktor: { sync: 'syncTraktor', add: 'addToTraktor' },
}

export const DJ_COLLECTION_PATH: Record<
  DjProgram,
  'rekordboxDbPath' | 'traktorNmlPath' | 'engineLibraryDir'
> = {
  rekordbox: 'rekordboxDbPath',
  engine: 'engineLibraryDir',
  traktor: 'traktorNmlPath',
}
