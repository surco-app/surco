import { programsInOrder } from '../../../shared/djProgram'
import type { Settings } from '../../../shared/types'
import type { DjLibraryId } from './djLibraries'

export type DjReach = 'off' | 'update' | 'add'

export const DJ_REACH_SETTINGS: Record<
  DjLibraryId,
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
  DjLibraryId,
  'rekordboxDbPath' | 'traktorNmlPath' | 'engineLibraryDir'
> = {
  rekordbox: 'rekordboxDbPath',
  engine: 'engineLibraryDir',
  traktor: 'traktorNmlPath',
}

export type DjAddKey = (typeof DJ_REACH_SETTINGS)[DjLibraryId]['add']
export type DjSyncKey = (typeof DJ_REACH_SETTINGS)[DjLibraryId]['sync']

const ORDER = programsInOrder(['rekordbox', 'engine', 'traktor'])

export function toDjReach(sync: boolean, add: boolean): DjReach {
  if (add) return 'add'
  return sync ? 'update' : 'off'
}

export function fromDjReach(r: DjReach): { sync: boolean; add: boolean } {
  return { sync: r !== 'off', add: r === 'add' }
}

export function reachedPrograms(
  s: Pick<Settings, DjAddKey>,
  reachable?: ReadonlySet<DjLibraryId>,
): DjLibraryId[] {
  return ORDER.filter((id) => s[DJ_REACH_SETTINGS[id].add] && (!reachable || reachable.has(id)))
}
