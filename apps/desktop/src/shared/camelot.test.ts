import { describe, expect, it } from 'vitest'
import { camelotDistance, camelotOf } from './camelot'

describe('camelotOf', () => {
  it('keeps a Camelot key and strips a leading zero', () => {
    expect(camelotOf('8A')).toBe('8A')
    expect(camelotOf('08b')).toBe('8B')
  })

  it('converts the musical names a program may write', () => {
    expect(camelotOf('Am')).toBe('8A')
    expect(camelotOf('C')).toBe('8B')
    expect(camelotOf('F#')).toBe('2B')
    expect(camelotOf('Ebm')).toBe('2A')
  })

  it('returns null for anything it cannot read, so a track without a key is never guessed', () => {
    expect(camelotOf('')).toBeNull()
    expect(camelotOf(undefined)).toBeNull()
    expect(camelotOf('xyz')).toBeNull()
  })
})

describe('camelotDistance', () => {
  it('is 0 for the same key and 1 for a clean mix', () => {
    expect(camelotDistance('8A', '8A')).toBe(0)
    expect(camelotDistance('8A', '8B')).toBe(1)
    expect(camelotDistance('8A', '9A')).toBe(1)
    expect(camelotDistance('8A', '7A')).toBe(1)
  })

  it('treats the wheel as a circle', () => {
    expect(camelotDistance('12A', '1A')).toBe(1)
  })

  it('is greater than 1 for keys that clash', () => {
    expect(camelotDistance('8A', '10A') ?? 0).toBeGreaterThan(1)
    expect(camelotDistance('8A', '9B') ?? 0).toBeGreaterThan(1)
  })

  it('is null when either side has no key', () => {
    expect(camelotDistance(null, '8A')).toBeNull()
    expect(camelotDistance('8A', null)).toBeNull()
  })
})
