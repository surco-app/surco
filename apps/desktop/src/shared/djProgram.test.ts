import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  CUE_PROGRAMS,
  DJ_PROGRAMS,
  isWritable,
  PROGRAM_CAN,
  programOf,
  programsInOrder,
  RAIL_PROGRAMS,
  USB_PROGRAMS,
  type UsbProgram,
  WRITABLE_PROGRAMS,
  type WritableProgram,
  writableInOrder,
} from './djProgram'

describe('programOf', () => {
  it('reads Traktor and Engine ids by their prefix and everything else as rekordbox', () => {
    expect(programOf('traktor:HD/:Music/:t.aiff')).toBe('traktor')
    expect(programOf('engine:4')).toBe('engine')
    expect(programOf('engine:')).toBe('engine')
    expect(programOf('123456')).toBe('rekordbox')
    expect(programOf('')).toBe('rekordbox')
  })

  it('reads a Serato id by its prefix, so a Serato track never passes for a rekordbox one', () => {
    expect(programOf('serato:/Users/x/a.mp3')).toBe('serato')
  })
})

describe('programsInOrder', () => {
  it('keeps the order it is given', () => {
    expect(programsInOrder(['traktor', 'rekordbox', 'engine', 'serato'])).toEqual([
      'traktor',
      'rekordbox',
      'engine',
      'serato',
    ])
  })
  it('refuses at compile time an order that leaves a program out', () => {
    // @ts-expect-error
    programsInOrder(['rekordbox', 'traktor', 'engine'])
  })
  it('keeps rekordbox, Traktor and Engine as the canonical order of the programs Surco writes to', () => {
    expect(WRITABLE_PROGRAMS).toEqual(['rekordbox', 'traktor', 'engine'])
  })
  it('lists Serato after the others among every program it reads', () => {
    expect(DJ_PROGRAMS).toEqual(['rekordbox', 'traktor', 'engine', 'serato'])
  })
})

describe('writableInOrder', () => {
  it('refuses at compile time an order that leaves a writable program out', () => {
    // @ts-expect-error
    writableInOrder(['rekordbox', 'traktor'])
  })
  it('refuses at compile time an order that names Serato, which Surco does not write to yet', () => {
    // @ts-expect-error
    writableInOrder(['rekordbox', 'traktor', 'engine', 'serato'])
  })
  it('leaves Serato out of the programs Surco writes to, so no write path can reach a Serato track', () => {
    expect(WRITABLE_PROGRAMS).not.toContain('serato')
  })
})

describe('RAIL_PROGRAMS', () => {
  it('ends with Serato, the last program added to the rail', () => {
    expect(RAIL_PROGRAMS.at(-1)).toBe('serato')
  })
})

describe('isWritable', () => {
  it('answers yes for the programs Surco writes to and no for Serato', () => {
    expect(DJ_PROGRAMS.filter(isWritable)).toEqual(['rekordbox', 'traktor', 'engine'])
  })
})

describe('CUE_PROGRAMS', () => {
  it('saves cues to rekordbox, Engine, Traktor and then Serato, the four Surco writes cues to', () => {
    expect(CUE_PROGRAMS).toEqual(['rekordbox', 'engine', 'traktor', 'serato'])
  })
})

describe('PROGRAM_CAN', () => {
  it('derives the writable programs from the table, so a program is writable by one row and not by an edit to a type', () => {
    const writable = Object.entries(PROGRAM_CAN)
      .filter(([, can]) => can.write)
      .map(([program]) => program)
    expect([...WRITABLE_PROGRAMS].sort()).toEqual(writable.sort())
  })
  it('derives the USB programs from the table', () => {
    const usb = Object.entries(PROGRAM_CAN)
      .filter(([, can]) => can.usb)
      .map(([program]) => program)
    expect([...USB_PROGRAMS].sort()).toEqual(usb.sort())
    expect([...USB_PROGRAMS].sort()).toEqual(['engine', 'rekordbox', 'serato', 'traktor'])
  })
  it('types the writable and USB programs as exactly the rows marked true', () => {
    expectTypeOf<WritableProgram>().toEqualTypeOf<'rekordbox' | 'traktor' | 'engine'>()
    expectTypeOf<UsbProgram>().toEqualTypeOf<'rekordbox' | 'traktor' | 'engine' | 'serato'>()
  })
})
