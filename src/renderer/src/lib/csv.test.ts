import { describe, expect, it } from 'vitest'
import { csvHas, splitCsv, toggleCsv } from './csv'

describe('splitCsv', () => {
  it('trims and drops empty entries', () => {
    expect(splitCsv(' Bases ,, Cantaditas , ')).toEqual(['Bases', 'Cantaditas'])
  })
})

describe('csvHas', () => {
  it('matches a whole tag, not a substring', () => {
    expect(csvHas('Bases, Cantaditas', 'Bases')).toBe(true)
    expect(csvHas('Bases, Cantaditas', 'Base')).toBe(false)
  })
})

describe('toggleCsv', () => {
  it('adds a tag when absent', () => {
    expect(toggleCsv('Bases', 'Cantaditas')).toBe('Bases, Cantaditas')
  })

  it('removes a tag when present', () => {
    expect(toggleCsv('Bases, Cantaditas', 'Bases')).toBe('Cantaditas')
  })

  it('adds to an empty value', () => {
    expect(toggleCsv('', 'Bases')).toBe('Bases')
  })
})
