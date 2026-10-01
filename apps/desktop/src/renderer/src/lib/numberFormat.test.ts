import { describe, expect, it } from 'vitest'
import { formatFixed, formatUpTo } from './numberFormat'

describe('formatFixed', () => {
  it('keeps the digit count so a column of readouts holds its width', () => {
    expect(formatFixed(48, 1, 'es')).toBe('48,0')
    expect(formatFixed(-0.04, 1, 'en')).toBe('-0.0')
  })

  it('never groups thousands, since these are measurements', () => {
    expect(formatFixed(1234.5, 1, 'en')).toBe('1234.5')
  })
})

describe('formatUpTo', () => {
  it('drops a trailing zero and uses the decimal mark of the language', () => {
    expect(formatUpTo(3.4, 1, 'es')).toBe('3,4')
    expect(formatUpTo(2, 1, 'es')).toBe('2')
  })
})
