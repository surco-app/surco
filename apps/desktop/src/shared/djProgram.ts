import { isEngineContent } from './engineContent'
import { isSeratoContent } from './seratoContent'
import { isTraktorContent } from './traktorContent'
import { isVirtualdjContent } from './virtualdjContent'

export type DjProgram = 'rekordbox' | 'traktor' | 'engine' | 'serato' | 'virtualdj'

export const PROGRAM_CAN = {
  rekordbox: { write: true, usb: true, reach: true },
  traktor: { write: true, usb: true, reach: true },
  engine: { write: true, usb: true, reach: true },
  serato: { write: false, usb: true, reach: true },
  virtualdj: { write: false, usb: false, reach: false },
} as const satisfies { [P in DjProgram]: { write: boolean; usb: boolean; reach: boolean } }

type ProgramsThatCan<K extends 'write' | 'usb' | 'reach'> = {
  [P in DjProgram]: (typeof PROGRAM_CAN)[P][K] extends true ? P : never
}[DjProgram]

export type WritableProgram = ProgramsThatCan<'write'>

export type UsbProgram = ProgramsThatCan<'usb'>

export type ReachProgram = ProgramsThatCan<'reach'>

export type ReadOnlyProgram = Exclude<DjProgram, WritableProgram>

export type CueProgram = DjProgram

export type LibraryProgram = DjProgram

export const DJ_PROGRAMS = programsInOrder([
  'rekordbox',
  'traktor',
  'engine',
  'serato',
  'virtualdj',
])

export const LIBRARY_PROGRAMS: readonly LibraryProgram[] = programsInOrder([
  'rekordbox',
  'traktor',
  'engine',
  'serato',
  'virtualdj',
])

export const WRITABLE_PROGRAMS = writableInOrder(['rekordbox', 'traktor', 'engine'])

export const USB_PROGRAMS: readonly UsbProgram[] = DJ_PROGRAMS.filter(
  (program): program is UsbProgram => PROGRAM_CAN[program].usb,
)

export const REACH_PROGRAMS: readonly ReachProgram[] = DJ_PROGRAMS.filter(
  (program): program is ReachProgram => PROGRAM_CAN[program].reach,
)

export function canReach(program: DjProgram): program is ReachProgram {
  return PROGRAM_CAN[program].reach
}

export const READ_ONLY_PROGRAMS: readonly ReadOnlyProgram[] = DJ_PROGRAMS.filter(
  (program): program is ReadOnlyProgram => !PROGRAM_CAN[program].write,
)

export const RAIL_PROGRAMS = programsInOrder([
  'rekordbox',
  'engine',
  'traktor',
  'serato',
  'virtualdj',
])

export const CUE_PROGRAMS: readonly CueProgram[] = programsInOrder([
  'rekordbox',
  'engine',
  'traktor',
  'serato',
  'virtualdj',
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

const CONTENT_OF: Record<Exclude<DjProgram, 'rekordbox'>, (contentId: string) => boolean> = {
  traktor: isTraktorContent,
  engine: isEngineContent,
  serato: isSeratoContent,
  virtualdj: isVirtualdjContent,
}

export function programOf(contentId: string): DjProgram {
  for (const [program, isContent] of Object.entries(CONTENT_OF))
    if (isContent(contentId)) return program as DjProgram
  return 'rekordbox'
}
