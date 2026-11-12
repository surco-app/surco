import { isEngineContent } from './engineContent'
import { isSeratoContent } from './seratoContent'
import { isTraktorContent } from './traktorContent'
import { isVirtualdjContent } from './virtualdjContent'

export type DjProgram = 'rekordbox' | 'traktor' | 'engine' | 'serato' | 'virtualdj'

export const PROGRAM_CAN = {
  rekordbox: { write: true, usb: true, reach: true, windows: true },
  traktor: { write: true, usb: true, reach: true, windows: true },
  engine: { write: true, usb: true, reach: true, windows: true },
  serato: { write: false, usb: true, reach: true, windows: true },
  virtualdj: { write: true, usb: true, reach: true, windows: true },
} as const satisfies {
  [P in DjProgram]: {
    write: boolean
    usb: boolean
    reach: boolean
    windows: boolean
  }
}

type ProgramsThatCan<K extends 'write' | 'usb' | 'reach'> = {
  [P in DjProgram]: (typeof PROGRAM_CAN)[P][K] extends true ? P : never
}[DjProgram]

export type WritableProgram = ProgramsThatCan<'write'>

export type UsbProgram = ProgramsThatCan<'usb'>

export type ReachProgram = ProgramsThatCan<'reach'>

export type ReadOnlyProgram = Exclude<DjProgram, WritableProgram>

export type CueProgram = DjProgram

export type LibraryProgram = DjProgram

export const USB_EXPORT_ON = {
  rekordbox: { darwin: true, win32: true },
  traktor: { darwin: true, win32: true },
  engine: { darwin: true, win32: true },
  serato: { darwin: true, win32: false },
  virtualdj: { darwin: true, win32: false },
} as const satisfies Record<UsbProgram, { darwin: boolean; win32: boolean }>

export function exportsUsbOn(program: DjProgram, platform: string): boolean {
  if (!PROGRAM_CAN[program].usb || (platform !== 'darwin' && platform !== 'win32')) return false
  return USB_EXPORT_ON[program as UsbProgram][platform]
}

export const PROGRAM_BETA: Record<DjProgram, boolean> = {
  rekordbox: false,
  traktor: false,
  engine: false,
  serato: false,
  virtualdj: true,
}

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

export const WRITABLE_PROGRAMS = writableInOrder(['rekordbox', 'traktor', 'engine', 'virtualdj'])

export const USB_PROGRAMS: readonly UsbProgram[] = DJ_PROGRAMS.filter(
  (program): program is UsbProgram => PROGRAM_CAN[program].usb,
)

export const REACH_PROGRAMS: readonly ReachProgram[] = DJ_PROGRAMS.filter(
  (program): program is ReachProgram => PROGRAM_CAN[program].reach,
)

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
