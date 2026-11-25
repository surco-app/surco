// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fittedFontSize, renderStatsImage, statsImageCells } from './statsImage'

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
      beatportMatches: 0,
      musicbrainzMatches: 0,
      itunesMatches: 0,
    })
    expect(cells).toEqual([
      { key: 'imported', value: 812 },
      { key: 'analyzed', value: 512 },
      { key: 'discogsMatches', value: 301 },
      { key: 'deezerMatches', value: 44 },
    ])
  })

  // The card and the Stats tab tell the story in the same order, MusicBrainz last.
  it('includes MusicBrainz finds after the other sources', () => {
    const cells = statsImageCells({
      imported: 0,
      listened: 0,
      analyzed: 0,
      discogsMatches: 0,
      bandcampMatches: 0,
      deezerMatches: 3,
      beatportMatches: 0,
      musicbrainzMatches: 7,
      itunesMatches: 0,
    })
    expect(cells).toEqual([
      { key: 'deezerMatches', value: 3 },
      { key: 'musicbrainzMatches', value: 7 },
    ])
  })

  it('includes Apple Music finds after MusicBrainz, so the card reads in the same order as the Stats tab', () => {
    const cells = statsImageCells({
      imported: 0,
      listened: 0,
      analyzed: 0,
      discogsMatches: 0,
      bandcampMatches: 0,
      deezerMatches: 0,
      beatportMatches: 0,
      musicbrainzMatches: 2,
      itunesMatches: 5,
    })
    expect(cells).toEqual([
      { key: 'musicbrainzMatches', value: 2 },
      { key: 'itunesMatches', value: 5 },
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
        beatportMatches: 0,
        musicbrainzMatches: 0,
        itunesMatches: 0,
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
      beatportMatches: 0,
      musicbrainzMatches: 0,
      itunesMatches: 0,
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
      beatportMatches: 0,
      musicbrainzMatches: 0,
      itunesMatches: 0,
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
      beatportMatches: 0,
      musicbrainzMatches: 0,
      itunesMatches: 0,
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
      beatportMatches: 0,
      musicbrainzMatches: 0,
      itunesMatches: 0,
    })
    expect(cells).toHaveLength(4)
    expect(cells.map((c) => c.key)).toEqual(['imported', 'listened', 'analyzed', 'discogsMatches'])
  })
})

// fillText's maxWidth squeezes the glyphs sideways instead of wrapping, so "Tu as économisé
// environ 243 journées de travail" came out as condensed type no other language got.
describe('fittedFontSize', () => {
  it('keeps the design size when the text already fits', () => {
    expect(fittedFontSize(46, 764, 828)).toBe(46)
  })

  it('shrinks the size in proportion so a long translation fits at its natural width', () => {
    expect(fittedFontSize(46, 1021, 828)).toBe(37)
  })
})

// jsdom draws nothing, so the card's canvas gets a context that only records the text it
// is asked to paint and where. Shapes are accepted and ignored: what the card says is what
// someone scrolling past it reads.
interface DrawnText {
  text: string
  x: number
  y: number
}

let drawn: DrawnText[] = []

function recordingContext(): CanvasRenderingContext2D {
  const ignore = (): void => {}
  const ctx: Partial<CanvasRenderingContext2D> = {
    fillStyle: '',
    strokeStyle: '',
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    letterSpacing: '0px',
    lineWidth: 1,
    measureText: (text: string) => ({ width: text.length * 10 }) as TextMetrics,
    fillText: (text: string, x: number, y: number) => {
      drawn.push({ text, x, y })
    },
    fillRect: ignore,
    beginPath: ignore,
    arc: ignore,
    roundRect: ignore,
    fill: ignore,
    stroke: ignore,
  }
  return ctx as CanvasRenderingContext2D
}

function at(text: string): DrawnText {
  const found = drawn.find((d) => d.text === text)
  if (!found) throw new Error(`"${text}" was not drawn`)
  return found
}

const card = {
  title: 'My year in Surco',
  language: 'en',
  conversionCount: 25000,
  countLabel: 'tracks converted',
  cells: [
    { value: 1200, label: 'imported' },
    { value: 800, label: 'analyzed' },
    { value: 300, label: 'found on Discogs' },
  ],
  timeSaved: 'About 3 days saved',
  perTrack: '10 s per track',
  footer: 'surco.app',
}

beforeEach(() => {
  drawn = []
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(recordingContext)
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,CARD')
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('renderStatsImage', () => {
  // The PNG goes to the save dialog and then to an Instagram story, so what comes back
  // must be the card canvas encoded as PNG.
  it('returns the card as a PNG data URL', () => {
    expect(renderStatsImage(card)).toBe('data:image/png;base64,CARD')
    expect(HTMLCanvasElement.prototype.toDataURL).toHaveBeenCalledWith('image/png')
  })

  // A story viewer has no app open: the brand and the title are what tell them whose
  // card this is, so they lead the card from the top.
  it('opens with the wordmark and then the title', () => {
    renderStatsImage(card)
    expect(drawn[0].text).toBe('SURCO')
    expect(drawn[1].text).toBe('My year in Surco')
    expect(at('My year in Surco').y).toBeGreaterThan(at('SURCO').y)
  })

  // The lifetime conversions are the headline, written the way the sender's language
  // groups digits, so a German card says 25.000 and an English one 25,000.
  it('shows the conversion hero formatted for the language', () => {
    renderStatsImage({ ...card, language: 'de' })
    expect(at('25.000').y).toBeLessThan(at('tracks converted').y)
    drawn = []
    renderStatsImage(card)
    expect(at('25,000').y).toBeLessThan(at('tracks converted').y)
  })

  // Activity without conversions still deserves a card, but a giant "0 tracks converted"
  // would turn the brag into an anti-achievement.
  it('leaves the hero out when nothing was converted', () => {
    renderStatsImage({ ...card, conversionCount: 0 })
    expect(drawn.map((d) => d.text)).not.toContain('tracks converted')
    expect(drawn.map((d) => d.text)).not.toContain('0')
    expect(at('1,200').y).toBeGreaterThan(at('My year in Surco').y)
  })

  // Two columns side by side, each value with its label under it; an odd last tally sits
  // centred on its own row instead of hanging off the left column.
  it('lays the tallies out in two columns and centres an odd last one', () => {
    renderStatsImage(card)
    const first = at('1,200')
    const second = at('800')
    const last = at('300')
    expect([first.x, second.x, last.x]).toEqual([300, 780, 540])
    expect(second.y).toBe(first.y)
    expect(last.y).toBeGreaterThan(first.y)
    expect(at('imported')).toEqual({ text: 'imported', x: 300, y: first.y + 46 })
    expect(at('found on Discogs').x).toBe(540)
  })

  it('fills a second row with two columns when there are four tallies', () => {
    renderStatsImage({ ...card, cells: [...card.cells, { value: 44, label: 'found on Deezer' }] })
    expect([at('300').x, at('44').x]).toEqual([300, 780])
    expect(at('44').y).toBe(at('300').y)
    expect(at('300').y).toBeGreaterThan(at('1,200').y)
  })

  // Everything on the card is something a stranger can read: no milestone line like
  // "2583 to go until 25000", which only motivates the sender. Only the wordmark and the
  // caller's own strings are drawn, and all of them inside the story frame.
  it('draws only the wordmark and the given stats, inside the card', () => {
    renderStatsImage(card)
    expect(drawn.map((d) => d.text)).toEqual([
      'SURCO',
      'My year in Surco',
      '25,000',
      'tracks converted',
      '1,200',
      'imported',
      '800',
      'analyzed',
      '300',
      'found on Discogs',
      'About 3 days saved',
      '10 s per track',
      'surco.app',
    ])
    expect(drawn.every((d) => d.y > 0 && d.y < 1920 && d.x > 0 && d.x < 1080)).toBe(true)
  })
})
