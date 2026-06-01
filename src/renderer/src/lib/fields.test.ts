import { describe, it, expect } from 'vitest'
import { moveItem, DEFAULT_FIELDS, FIELD_DEFS } from './fields'

describe('moveItem', () => {
  it('moves an item down so the user can reorder a shown field', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c'])
  })

  it('moves an item up', () => {
    expect(moveItem(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b'])
  })

  it('returns the array untouched when the move falls off either end', () => {
    expect(moveItem(['a', 'b'], 0, -1)).toEqual(['a', 'b'])
    expect(moveItem(['a', 'b'], 1, 1)).toEqual(['a', 'b'])
  })
})

describe('DEFAULT_FIELDS', () => {
  it('lists every editable field so the default editor is unchanged', () => {
    expect(DEFAULT_FIELDS).toEqual(FIELD_DEFS.map((d) => d.key))
    expect(DEFAULT_FIELDS).toContain('trackNumber')
  })
})
