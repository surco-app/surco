import { isEngineContent } from './engineContent'
import { isSeratoContent } from './seratoContent'
import { isTraktorContent } from './traktorContent'

export type DjProgram = 'rekordbox' | 'traktor' | 'engine' | 'serato'

export type WritableProgram = Exclude<DjProgram, 'serato'>

export type CueProgram = DjProgram

export const DJ_PROGRAMS = programsInOrder(['rekordbox', 'traktor', 'engine', 'serato'])

export const WRITABLE_PROGRAMS = writableInOrder(['rekordbox', 'traktor', 'engine'])

export const RAIL_PROGRAMS = programsInOrder(['rekordbox', 'engine', 'traktor', 'serato'])

export const CUE_PROGRAMS: readonly CueProgram[] = programsInOrder([
  'rekordbox',
  'engine',
  'traktor',
  'serato',
])

type AllOf<T extends readonly DjProgram[]> = [Exclude<DjProgram, T[number]>] extends [never]
  ? unknown
  : never

type AllWritableOf<T extends readonly WritableProgram[]> = [
  Exclude<WritableProgram, T[number]>,
] extends [never]
  ? unknown
  : never

export function programsInOrder<const T extends readonly DjProgram[]>(
  order: T & AllOf<T>,
): readonly DjProgram[] {
  return order
}

export function writableInOrder<const T extends readonly WritableProgram[]>(
  order: T & AllWritableOf<T>,
): readonly WritableProgram[] {
  return order
}

export function isWritable(program: DjProgram): program is WritableProgram {
  return (WRITABLE_PROGRAMS as readonly DjProgram[]).includes(program)
}

export function programOf(contentId: string): DjProgram {
  if (isTraktorContent(contentId)) return 'traktor'
  if (isEngineContent(contentId)) return 'engine'
  if (isSeratoContent(contentId)) return 'serato'
  return 'rekordbox'
}
