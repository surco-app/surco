import { describe, expect, it } from 'vitest'
import {
  DJ_PROGRAMS,
  programOf,
  programsInOrder,
  RAIL_PROGRAMS,
  WRITABLE_PROGRAMS,
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
