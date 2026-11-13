import { DJ_REACH_SETTINGS } from '../../../shared/djSettings'
import type { DjLibraryId } from './djLibraries'

export { DJ_REACH_SETTINGS }

export type DjReach = 'off' | 'update' | 'add'

export type DjAddKey = (typeof DJ_REACH_SETTINGS)[DjLibraryId]['add']
export type DjSyncKey = (typeof DJ_REACH_SETTINGS)[DjLibraryId]['sync']

export function toDjReach(sync: boolean, add: boolean): DjReach {
  if (add) return 'add'
  return sync ? 'update' : 'off'
}

export function fromDjReach(r: DjReach): { sync: boolean; add: boolean } {
  return { sync: r !== 'off', add: r === 'add' }
}
