import type { LibraryProgram, WritableProgram } from './djProgram'

export const DJ_REACH_SETTINGS: Record<
  LibraryProgram,
  {
    sync: 'syncRekordbox' | 'syncTraktor' | 'syncEngineDj' | 'syncSerato' | 'syncVirtualdj'
    add: 'addToRekordbox' | 'addToTraktor' | 'addToEngineDj' | 'addToSerato' | 'addToVirtualdj'
  }
> = {
  rekordbox: { sync: 'syncRekordbox', add: 'addToRekordbox' },
  engine: { sync: 'syncEngineDj', add: 'addToEngineDj' },
  traktor: { sync: 'syncTraktor', add: 'addToTraktor' },
  serato: { sync: 'syncSerato', add: 'addToSerato' },
  virtualdj: { sync: 'syncVirtualdj', add: 'addToVirtualdj' },
}

export const DJ_COLLECTION_PATH: Record<
  WritableProgram,
  'rekordboxDbPath' | 'traktorNmlPath' | 'engineLibraryDir'
> = {
  rekordbox: 'rekordboxDbPath',
  engine: 'engineLibraryDir',
  traktor: 'traktorNmlPath',
}
