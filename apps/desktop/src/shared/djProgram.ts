import { isEngineContent } from './engineContent'
import { isTraktorContent } from './traktorContent'

export type DjProgram = 'rekordbox' | 'traktor' | 'engine'

export const DJ_PROGRAMS = programsInOrder(['rekordbox', 'traktor', 'engine'])

export const RAIL_PROGRAMS = programsInOrder(['rekordbox', 'engine', 'traktor'])

type AllOf<T extends readonly DjProgram[]> = [Exclude<DjProgram, T[number]>] extends [never]
  ? unknown
  : never

export function programsInOrder<const T extends readonly DjProgram[]>(
  order: T & AllOf<T>,
): readonly DjProgram[] {
  return order
}

export function programOf(contentId: string): DjProgram {
  if (isTraktorContent(contentId)) return 'traktor'
  if (isEngineContent(contentId)) return 'engine'
  return 'rekordbox'
}
