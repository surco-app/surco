import { describe, expect, it } from 'vitest'
import { nextSection } from './sectionNav'

// The editor has 133 tab stops with a single section open, so reaching the silence
// trimmer from the title field means crossing dozens of fields. These jumps move by
// SECTION, over the headers, which is the whole point.
describe('nextSection', () => {
  const shown = ['form', 'quality', 'trim', 'output']

  it('steps to the next section', () => {
    expect(nextSection(shown, 'quality', 1)).toBe('trim')
  })

  it('steps to the previous section', () => {
    expect(nextSection(shown, 'trim', -1)).toBe('quality')
  })

  // No wrapping: with the list scrolled you cannot see where it ends, so jumping from
  // the last section back to the first reads as the keys having lost their place.
  it('stays put at either end instead of wrapping', () => {
    expect(nextSection(shown, 'output', 1)).toBe('output')
    expect(nextSection(shown, 'form', -1)).toBe('form')
  })

  // The caller passes only the sections actually on screen — hidden in Settings, or not
  // rendered because they do not apply — so a jump can never land on a header that is
  // not there.
  it('only walks the sections it was given', () => {
    expect(nextSection(['form', 'output'], 'form', 1)).toBe('output')
  })

  // Nothing focused yet (the user just entered the editor): the first jump forward has
  // to land somewhere, and the top of the list is where reading starts.
  it('enters at the first section when nothing is current', () => {
    expect(nextSection(shown, null, 1)).toBe('form')
    expect(nextSection(shown, null, -1)).toBe('form')
  })

  // A section that vanished under the user (its condition stopped holding while focused)
  // must not strand the keys.
  it('falls back to the first section when the current one is gone', () => {
    expect(nextSection(shown, 'declick', 1)).toBe('form')
  })

  it('returns null with no sections to walk', () => {
    expect(nextSection([], null, 1)).toBeNull()
  })
})
