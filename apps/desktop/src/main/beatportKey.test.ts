import { describe, expect, it } from 'vitest'
import { beatportKey } from './beatportKey'

describe('beatportKey', () => {
  it('speaks the notation the user picked, Camelot by default', () => {
    expect(beatportKey('G Major', 'camelot')).toBe('9B')
    expect(beatportKey('A Minor', 'camelot')).toBe('8A')
    expect(beatportKey('Eb Minor', 'camelot')).toBe('2A')
  })

  it('reads sharps and flats alike, since Beatport uses both', () => {
    expect(beatportKey('A# Minor', 'camelot')).toBe('3A')
    expect(beatportKey('Bb Minor', 'camelot')).toBe('3A')
    expect(beatportKey('Gb Major', 'camelot')).toBe('2B')
    expect(beatportKey('F# Major', 'camelot')).toBe('2B')
    expect(beatportKey('Db Major', 'camelot')).toBe('3B')
  })

  it('musical notation follows the Mixed In Key names the detector already writes', () => {
    expect(beatportKey('Eb Minor', 'musical')).toBe('Ebm')
    expect(beatportKey('A# Major', 'musical')).toBe('Bb')
    expect(beatportKey('C# Minor', 'musical')).toBe('C#m')
  })

  it("an unknown or missing key gives nothing, so it never overwrites the track's own", () => {
    expect(beatportKey('', 'camelot')).toBe('')
    expect(beatportKey(undefined, 'camelot')).toBe('')
    expect(beatportKey('Unknown', 'musical')).toBe('')
  })
})
