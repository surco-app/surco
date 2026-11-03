import type { WritableProgram } from './djProgram'

export const DJ_REACH_SETTINGS: Record<
  WritableProgram,
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
  WritableProgram,
  'rekordboxDbPath' | 'traktorNmlPath' | 'engineLibraryDir'
> = {
  rekordbox: 'rekordboxDbPath',
  engine: 'engineLibraryDir',
  traktor: 'traktorNmlPath',
}
