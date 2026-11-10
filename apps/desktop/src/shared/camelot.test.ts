import { describe, expect, it } from 'vitest'
import { camelotDistance, camelotOf, keyIn } from './camelot'

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

  it('reads either spelling of a key and any case, as the sort by key already does, so a tag from another program still mixes harmonically', () => {
    expect(camelotOf('Abm')).toBe('1A')
    expect(camelotOf('G#m')).toBe('1A')
    expect(camelotOf('Db')).toBe('3B')
    expect(camelotOf('C#')).toBe('3B')
    expect(camelotOf('a#m')).toBe('3A')
    expect(camelotOf('am')).toBe('8A')
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

describe('keyIn', () => {
  it('writes the key the way the DJ chose in Settings, whichever way the tag spells it', () => {
    expect(keyIn('Am', 'camelot')).toBe('8A')
    expect(keyIn('08A', 'camelot')).toBe('8A')
    expect(keyIn('8A', 'musical')).toBe('Am')
    expect(keyIn('11b', 'musical')).toBe('A')
    expect(keyIn(' F#m ', 'musical')).toBe('F#m')
    expect(keyIn('Abm', 'camelot')).toBe('1A')
    expect(keyIn('Abm', 'musical')).toBe('G#m')
  })

  it('shows a key it cannot read as the tag has it, so nothing on the row is made up', () => {
    expect(keyIn(' 6m ', 'musical')).toBe('6m')
  })
})
