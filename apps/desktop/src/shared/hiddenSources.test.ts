import { describe, expect, it } from 'vitest'
import { normalizeHiddenSources } from './hiddenSources'

describe('normalizeHiddenSources', () => {
  it('keeps the sources it knows, in the order the user hid them', () => {
    expect(normalizeHiddenSources(['engine', 'rekordbox', 'appleMusic'])).toEqual([
      'engine',
      'rekordbox',
      'appleMusic',
    ])
  })

  it('drops what a hand-edited or newer file holds, so the rail never waits on a source this version lacks', () => {
    expect(normalizeHiddenSources(['traktor', 3, null, 'appleMusic'])).toEqual(['appleMusic'])
  })

  it('lists a source once however many times it was stored', () => {
    expect(normalizeHiddenSources(['rekordbox', 'rekordbox'])).toEqual(['rekordbox'])
  })

  it('shows every source when the stored value is not a list', () => {
    for (const value of [undefined, null, 'rekordbox', {}, 0]) {
      expect(normalizeHiddenSources(value)).toEqual([])
    }
  })
})
