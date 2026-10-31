import { describe, expect, it } from 'vitest'
import { hasGenreMarker, judgeGenre } from './genreDamage'

// A damaged genre is listed only with proof of what it was: a library that kept the text the
// user wrote is a sure repair; without one, a reversal the old damage replays back to the same
// bytes is only likely, since an old tag can carry an ID3v1 number on purpose.
describe('judgeGenre', () => {
  it('is sure when a library kept the text the damage replays to the bytes on disk', () => {
    expect(
      judgeGenre('(35) Deep House', [{ source: 'traktor', value: 'House; Deep House' }]),
    ).toEqual({
      kind: 'genre-number',
      certainty: 'sure',
      options: ['House; Deep House'],
      source: 'traktor',
    })
  })

  it('is likely without a library, joining with ";" when the rest starts with a space', () => {
    const j = judgeGenre('(35) Deep House', [])
    expect(j?.certainty).toBe('likely')
    expect(j?.options[0]).toBe('House; Deep House')
  })

  it('joins with "/" when the rest follows the number directly', () => {
    expect(judgeGenre('(35)Deep House', [])?.options[0]).toBe('House/Deep House')
  })

  it('undoes doubled parentheses and the slash split inside them', () => {
    const j = judgeGenre('Techno ((((Peak Time ; Driving)', [])
    expect(j?.kind).toBe('genre-parens')
    expect(j?.options[0]).toBe('Techno (Peak Time / Driving)')
  })

  it.each(['Techno (Peak Time)', '(17)', 'Deep House; Tech House'])('leaves "%s" alone', (raw) => {
    expect(judgeGenre(raw, [])).toBeNull()
  })

  // Engine DJ read the file after an earlier save had already damaged it: its value replays
  // to the bytes on disk, but proposing it would write damage back as the repair.
  it('takes no proof from a library value that is itself damaged', () => {
    const j = judgeGenre('Techno ((((Peak Time ; Driving)', [
      { source: 'engine', value: 'Techno ((Peak Time ; Driving)' },
    ])
    expect(j?.certainty).toBe('likely')
    expect(j?.options[0]).toBe('Techno (Peak Time / Driving)')
  })

  it('ignores a library value the damage does not replay to the bytes on disk', () => {
    expect(judgeGenre('(35) Deep House', [{ source: 'engine', value: 'House' }])?.certainty).toBe(
      'likely',
    )
  })
})

describe('hasGenreMarker', () => {
  it.each([
    ['(35) Deep House', true],
    ['Techno ((Peak Time', true],
    ['(999) Deep House', false],
    ['Techno (Peak Time)', false],
  ])('%s → %s', (raw, marked) => {
    expect(hasGenreMarker(raw)).toBe(marked)
  })
})
