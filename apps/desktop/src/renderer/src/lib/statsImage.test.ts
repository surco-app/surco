import { describe, expect, it } from 'vitest'
import { statsImageCells } from './statsImage'

describe('statsImageCells', () => {
  // The share card is a brag sheet, not a report: a "0 encontradas en Bandcamp" row
  // reads as an anti-achievement, so zero tallies are dropped instead of rendered.
  it('keeps only the tallies with activity, in the grid order', () => {
    const cells = statsImageCells({
      imported: 812,
      listened: 0,
      analyzed: 512,
      discogsMatches: 301,
      bandcampMatches: 0,
      deezerMatches: 44,
    })
    expect(cells).toEqual([
      { key: 'imported', value: 812 },
      { key: 'analyzed', value: 512 },
      { key: 'discogsMatches', value: 301 },
      { key: 'deezerMatches', value: 44 },
    ])
  })

  it('returns nothing when every tally is zero', () => {
    expect(
      statsImageCells({
        imported: 0,
        listened: 0,
        analyzed: 0,
        discogsMatches: 0,
        bandcampMatches: 0,
        deezerMatches: 0,
      }),
    ).toEqual([])
  })
})
