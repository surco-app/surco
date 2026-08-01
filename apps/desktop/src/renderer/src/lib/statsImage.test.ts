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

  // A tally that is a rounding error next to the rest reads as something broken
  // rather than something achieved — "6 found on Deezer" beside "11091 found on
  // Discogs" makes Deezer look like it failed, on a card whose job is to impress.
  it('keeps the four biggest tallies and leaves the tail off', () => {
    const cells = statsImageCells({
      imported: 16282,
      listened: 266,
      analyzed: 1374,
      discogsMatches: 11091,
      bandcampMatches: 298,
      deezerMatches: 6,
    })
    expect(cells.map((c) => c.key)).toEqual([
      'imported',
      'analyzed',
      'discogsMatches',
      'bandcampMatches',
    ])
  })

  // Ranking by size, not by a share of the top tally: measured against real numbers a
  // percentage cut put Bandcamp (1.8% of the biggest) on the wrong side of the line
  // while keeping nothing else, and tracks-played sits at 1.6% — no threshold
  // separates them, so size has to.
  it('keeps a small tally when it is among the four biggest', () => {
    const cells = statsImageCells({
      imported: 40000,
      listened: 0,
      analyzed: 0,
      discogsMatches: 30000,
      bandcampMatches: 20000,
      deezerMatches: 12,
    })
    expect(cells.map((c) => c.key)).toContain('deezerMatches')
  })

  // The same small numbers must survive when nothing dwarfs them, or a new user's
  // card would come out empty.
  it('keeps small tallies when they are all there is', () => {
    const cells = statsImageCells({
      imported: 12,
      listened: 3,
      analyzed: 8,
      discogsMatches: 5,
      bandcampMatches: 0,
      deezerMatches: 1,
    })
    expect(cells.map((c) => c.key)).toEqual(['imported', 'listened', 'analyzed', 'discogsMatches'])
  })

  // Six cells make a lopsided three-row grid on a 9:16 card; four fill two clean
  // rows, so the card never grows a stray half-row.
  it('never returns more than four cells', () => {
    const cells = statsImageCells({
      imported: 1000,
      listened: 900,
      analyzed: 800,
      discogsMatches: 700,
      bandcampMatches: 600,
      deezerMatches: 500,
    })
    expect(cells).toHaveLength(4)
    expect(cells.map((c) => c.key)).toEqual([
      'imported',
      'listened',
      'analyzed',
      'discogsMatches',
    ])
  })
})
