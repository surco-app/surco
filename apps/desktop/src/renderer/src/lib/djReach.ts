import { writableInOrder } from '../../../shared/djProgram'
import { DJ_COLLECTION_PATH, DJ_REACH_SETTINGS } from '../../../shared/djSettings'
import type { Settings } from '../../../shared/types'
import type { DjLibraryId } from './djLibraries'

export { DJ_COLLECTION_PATH, DJ_REACH_SETTINGS }

export type DjReach = 'off' | 'update' | 'add'

export type DjAddKey = (typeof DJ_REACH_SETTINGS)[DjLibraryId]['add']
export type DjSyncKey = (typeof DJ_REACH_SETTINGS)[DjLibraryId]['sync']

const ORDER = writableInOrder(['rekordbox', 'engine', 'traktor'])

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
