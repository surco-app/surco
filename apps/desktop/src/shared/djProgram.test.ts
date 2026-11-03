import { describe, expect, it } from 'vitest'
import { DJ_PROGRAMS, programOf, programsInOrder } from './djProgram'

describe('programOf', () => {
  it('reads Traktor and Engine ids by their prefix and everything else as rekordbox', () => {
    expect(programOf('traktor:HD/:Music/:t.aiff')).toBe('traktor')
    expect(programOf('engine:4')).toBe('engine')
    expect(programOf('engine:')).toBe('engine')
    expect(programOf('123456')).toBe('rekordbox')
    expect(programOf('')).toBe('rekordbox')
  })
})

describe('programsInOrder', () => {
  it('keeps the order it is given', () => {
    expect(programsInOrder(['traktor', 'rekordbox', 'engine'])).toEqual([
      'traktor',
      'rekordbox',
      'engine',
    ])
  })
  it('refuses at compile time an order that leaves a program out', () => {
    // @ts-expect-error
    programsInOrder(['rekordbox', 'traktor'])
    expect(DJ_PROGRAMS).toEqual(['rekordbox', 'traktor', 'engine'])
  })
})
