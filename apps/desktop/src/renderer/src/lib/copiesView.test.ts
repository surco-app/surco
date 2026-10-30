import { describe, expect, it } from 'vitest'
import type { ProgramCopies } from '../../../shared/types'
import { COPIES_KEEP, programState, railAlert } from './copiesView'

function program(over: Partial<ProgramCopies> = {}): ProgramCopies {
  return {
    program: 'traktor',
    collectionPath: '/music/collection.nml',
    copies: [],
    restore: null,
    pending: 0,
    halted: false,
    copyFailed: false,
    untouched: false,
    ...over,
  }
}

describe('programState', () => {
  it('a halted queue outranks waiting changes', () => {
    expect(programState(program({ halted: true, pending: 3, copyFailed: true }))).toBe('halted')
  })

  it('a failed copy outranks waiting changes because nothing was written', () => {
    expect(programState(program({ copyFailed: true, pending: 2 }))).toBe('failed')
  })

  it('waiting changes outrank a program the user left alone', () => {
    expect(programState(program({ pending: 1, untouched: true }))).toBe('pending')
  })

  it('a program the user chose not to touch says so', () => {
    expect(programState(program({ untouched: true }))).toBe('untouched')
  })

  it('a program with nothing wrong is up to date', () => {
    expect(programState(program())).toBe('ok')
  })
})

describe('railAlert', () => {
  it('a failed copy turns the rail red', () => {
    expect(railAlert([program(), program({ copyFailed: true })])).toBe('danger')
  })

  it('a halted queue turns the rail red', () => {
    expect(railAlert([program({ halted: true })])).toBe('danger')
  })

  it('waiting changes alone turn it amber', () => {
    expect(railAlert([program({ pending: 2 }), program()])).toBe('warn')
  })

  it('red wins over amber when both happen', () => {
    expect(railAlert([program({ pending: 2 }), program({ copyFailed: true })])).toBe('danger')
  })

  it('untouched with no problems shows no dot', () => {
    expect(railAlert([program({ untouched: true }), program()])).toBe('none')
  })
})

describe('COPIES_KEEP', () => {
  it('matches the five history copies the footer promises', () => {
    expect(COPIES_KEEP).toBe(5)
  })
})
