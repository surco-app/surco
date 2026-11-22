import { describe, expect, it } from 'vitest'
import { aggregateLibraryVerdict } from './libraryVerdict'

describe('aggregateLibraryVerdict', () => {
  it('lets a better library copy win over everything else', () => {
    expect(aggregateLibraryVerdict(['here', 'library'])).toBe('library')
  })

  it('waits while any copy is still being measured', () => {
    expect(aggregateLibraryVerdict(['here', 'measuring'])).toBe('measuring')
  })

  it('prefers this file over a copy that is the same', () => {
    expect(aggregateLibraryVerdict(['here', 'same'])).toBe('here')
  })

  it('reports same when it is the only decision', () => {
    expect(aggregateLibraryVerdict(['same', null])).toBe('same')
  })

  it('has no verdict when no copy decided', () => {
    expect(aggregateLibraryVerdict([null])).toBeNull()
    expect(aggregateLibraryVerdict([])).toBeNull()
  })
})
