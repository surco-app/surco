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

const ORDER: DjLibraryId[] = ['rekordbox', 'engine', 'traktor']

export function toDjReach(sync: boolean, add: boolean): DjReach {
  if (add) return 'add'
  return sync ? 'update' : 'off'
}

export function fromDjReach(r: DjReach): { sync: boolean; add: boolean } {
  return { sync: r !== 'off', add: r === 'add' }
}

export function reachedPrograms(
  s: Pick<Settings, 'addToRekordbox' | 'addToTraktor' | 'addToEngineDj'>,
): DjLibraryId[] {
  return ORDER.filter((id) => s[DJ_REACH_SETTINGS[id].add])
}
