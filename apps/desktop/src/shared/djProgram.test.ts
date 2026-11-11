import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  CUE_PROGRAMS,
  DJ_PROGRAMS,
  isWritable,
  PROGRAM_CAN,
  programOf,
  programsInOrder,
  RAIL_PROGRAMS,
  REACH_PROGRAMS,
  READ_ONLY_PROGRAMS,
  type ReachProgram,
  type ReadOnlyProgram,
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

  it('reads a VirtualDJ id by its prefix, so a VirtualDJ track never passes for a rekordbox one', () => {
    expect(programOf('virtualdj:/Music/x.mp3')).toBe('virtualdj')
  })
})

describe('programsInOrder', () => {
  it('keeps the order it is given', () => {
    expect(programsInOrder(['traktor', 'rekordbox', 'engine', 'serato', 'virtualdj'])).toEqual([
      'traktor',
      'rekordbox',
      'engine',
      'serato',
      'virtualdj',
    ])
  })
  it('refuses at compile time an order that leaves a program out', () => {
    // @ts-expect-error
    programsInOrder(['rekordbox', 'traktor', 'engine'])
  })
  it('keeps rekordbox, Traktor, Engine and then VirtualDJ as the canonical order of the programs Surco writes to', () => {
    expect(WRITABLE_PROGRAMS).toEqual(['rekordbox', 'traktor', 'engine', 'virtualdj'])
  })
  it('lists Serato and then VirtualDJ after the others among every program it reads', () => {
    expect(DJ_PROGRAMS).toEqual(['rekordbox', 'traktor', 'engine', 'serato', 'virtualdj'])
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
  it('writes to VirtualDJ, so a VirtualDJ track can be converted, and exports its lists to a USB', () => {
    expect(PROGRAM_CAN.virtualdj).toEqual({
      write: true,
      usb: true,
      reach: true,
      windows: false,
    })
    expect(WRITABLE_PROGRAMS).toContain('virtualdj')
    expect(USB_PROGRAMS).toContain('virtualdj')
  })
  it('lets Surco add to and sync tags with every program, VirtualDJ included', () => {
    expect([...REACH_PROGRAMS]).toEqual(['rekordbox', 'traktor', 'engine', 'serato', 'virtualdj'])
    expectTypeOf<ReachProgram>().toEqualTypeOf<
      'rekordbox' | 'traktor' | 'engine' | 'serato' | 'virtualdj'
    >()
  })
})

describe('RAIL_PROGRAMS', () => {
  it('ends with VirtualDJ, the last program added to the rail', () => {
    expect(RAIL_PROGRAMS.at(-1)).toBe('virtualdj')
  })
})

describe('isWritable', () => {
  it('answers yes for the programs Surco writes to and no for Serato', () => {
    expect(DJ_PROGRAMS.filter(isWritable)).toEqual(['rekordbox', 'traktor', 'engine', 'virtualdj'])
  })
})

describe('CUE_PROGRAMS', () => {
  it('saves cues to rekordbox, Engine, Traktor and then Serato, with VirtualDJ last', () => {
    expect(CUE_PROGRAMS).toEqual(['rekordbox', 'engine', 'traktor', 'serato', 'virtualdj'])
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
    expect([...USB_PROGRAMS].sort()).toEqual([
      'engine',
      'rekordbox',
      'serato',
      'traktor',
      'virtualdj',
    ])
  })
  it('names as read only every library Surco cannot write, so each is still asked before a file it plays goes', () => {
    expect([...READ_ONLY_PROGRAMS]).toEqual(['serato'])
    expectTypeOf<ReadOnlyProgram>().toEqualTypeOf<'serato'>()
  })
  it('types the writable and USB programs as exactly the rows marked true', () => {
    expectTypeOf<WritableProgram>().toEqualTypeOf<
      'rekordbox' | 'traktor' | 'engine' | 'virtualdj'
    >()
    expectTypeOf<UsbProgram>().toEqualTypeOf<
      'rekordbox' | 'traktor' | 'engine' | 'serato' | 'virtualdj'
    >()
  })
})
