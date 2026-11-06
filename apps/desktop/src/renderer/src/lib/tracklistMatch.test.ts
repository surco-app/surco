import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { CollectionTrack } from '../../../shared/types'
import fixture from './fixtures/tracklistCollection.json'
import { baseTitle, matchTracklist, splitArtists } from './tracklistMatch'
import { parseTracklist } from './tracklistParse'

const SETS = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  '..',
  'docs',
  'superpowers',
  'specs',
  '2026-11-06-pegar-tracklist',
)
const set = (name: string): string => readFileSync(join(SETS, name), 'utf8')

const track = (artist: string, title: string): CollectionTrack => ({
  contentId: `${artist} - ${title}`,
  path: null,
  title,
  artist,
})
const line = (artist: string, title: string, suggested = false) => ({
  at: null,
  artist,
  title,
  suggested,
  raw: artist ? `${artist} - ${title}` : title,
})

const SMALL: CollectionTrack[] = [
  track('Sergi M, Solar System', 'Because Of You'),
  track('Jessy', 'Head Over Heels (Extended)'),
  track('3 Ways', 'Real Love (Extended Version)'),
  track('3 Ways', 'Real Love'),
  track('Stephan K', 'Action (Poky Mix)'),
  track('Jessy', 'Silent Tears (Extended Mix)'),
]

const match = (l: ReturnType<typeof line>, collection = SMALL) => matchTracklist([l], collection)[0]

describe('splitArtists', () => {
  it('splits on commas before folding, so the order of the artists does not matter', () => {
    expect(splitArtists('Solar System, Sergi M')).toEqual(['solar system', 'sergi m'])
  })

  it('splits on & and drops apostrophes', () => {
    expect(splitArtists("Head Horny's & Dj Miguel Serna")).toEqual([
      'head hornys',
      'dj miguel serna',
    ])
  })

  it('splits on presents', () => {
    expect(splitArtists('David Cabeza Presents Sadey')).toEqual(['david cabeza', 'sadey'])
  })

  it('treats Various Artists as nobody', () => {
    expect(splitArtists('Various Artists')).toEqual([])
  })
})

describe('baseTitle', () => {
  it('drops a trailing dash and digits', () => {
    expect(baseTitle('So Easy to Love you-7356')).toBe('so easy to love you')
  })

  it('drops the mix in parentheses', () => {
    expect(baseTitle('Secret (Extended Vocal)')).toBe('secret')
  })

  it('drops punctuation', () => {
    expect(baseTitle('Fire!!!')).toBe('fire')
  })
})

describe('matchTracklist levels', () => {
  it('finds a track whose artists come in another order', () => {
    const m = match(line('Solar System, Sergi M', 'Because of You'))
    expect(m.level).toBe('found')
    expect(m.candidates).toHaveLength(1)
  })

  it('lowers a suggested line to doubtful even when it matches exactly', () => {
    expect(match(line('Jessy', 'Silent Tears (Extended Mix)', true)).level).toBe('doubtful')
  })

  it('offers another mix of the same title as doubtful', () => {
    const m = match(line('Jessy', 'Head over heels (Radio Edit)'))
    expect(m.level).toBe('doubtful')
    expect(m.candidates[0].title).toBe('Head Over Heels (Extended)')
  })

  it('lists every candidate of a doubtful title, the closest first', () => {
    const m = match(line('3 Ways', 'Real Love (Extended Remastered)'))
    expect(m.level).toBe('doubtful')
    expect(m.candidates.map((c) => c.title)).toEqual(['Real Love (Extended Version)', 'Real Love'])
  })

  it('calls the same title by another artist similar, never found', () => {
    const m = match(line('Dj Dbc', 'Action (Poky Mix)'))
    expect(m.level).toBe('similar')
    expect(m.candidates[0].artist).toBe('Stephan K')
  })

  it('reports a track the collection lacks as absent', () => {
    const m = match(line('Rave Allstars', 'Bitte Anschnallen (Charter Mix)'))
    expect(m.level).toBe('absent')
    expect(m.candidates).toEqual([])
  })

  it('calls a line without artist similar when the title is in the collection', () => {
    const m = match(line('', 'Dancer (Spacio Mix)'), [track('Spacio', 'Dancer (Spacio Mix)')])
    expect(m.level).toBe('similar')
  })

  it('calls a bare artist name similar when that artist has exactly one track', () => {
    const one = [track('P.I.K.', 'Speakerfreak')]
    expect(match(line('', 'P.I.K'), one).level).toBe('similar')
    expect(match(line('', 'P.I.K'), [...one, track('P.I.K.', 'Other')]).level).toBe('absent')
  })

  it('forgives a typo within a fifth of the title', () => {
    const m = match(line('TLD', 'Tom apart'), [track('TLD', 'Torn Apart (Extended Version)')])
    expect(m.level).toBe('doubtful')
  })

  it('ignores articles when comparing titles', () => {
    expect(match(line('Gigaman', 'The trip'), [track('Gigaman', 'A Trip')]).level).toBe('doubtful')
  })

  it('accepts a title sharing most of its words', () => {
    const m = match(line('Amadin', 'You Make Me Feel Alright'), [
      track('Amadin', 'U Make Me Feel Alright (Extended Version)'),
    ])
    expect(m.level).toBe('doubtful')
  })
})

describe('matchTracklist against the real collection', () => {
  const collection: CollectionTrack[] = (fixture as { artist: string; title: string }[]).map((t) =>
    track(t.artist, t.title),
  )
  const counts = (name: string) => {
    const matches = matchTracklist(parseTracklist(set(name)).lines, collection)
    const by = { found: 0, doubtful: 0, similar: 0, absent: 0 }
    for (const m of matches) by[m.level]++
    return { matches, by }
  }

  it('reproduces the playlist the user built by hand for the XTV set', () => {
    const { matches, by } = counts('set3-xtv-remember.txt')
    expect(by).toEqual({ found: 9, doubtful: 19, similar: 3, absent: 0 })
    const gold = set('set3-playlist-a-mano.txt').trim().split('\n')
    const similar = matches
      .filter((m) => m.level === 'similar')
      .map((m) => m.candidates[0].contentId)
    expect(similar).toEqual([
      'Spacio - Dancer (Spacio Mix)',
      'Hard House Hooligans - Unbelievable',
      'P.I.K. - Speakerfreak',
    ])
    const rows = matches.filter((m) => m.level !== 'similar')
    const expected = gold.filter((g) => !similar.includes(g))
    const seen = new Set<string>()
    const chosen = rows.flatMap((m) => {
      const own = m.candidates.map((c) => c.contentId)
      const pick = own.find((id) => expected.includes(id)) ?? own[0]
      if (seen.has(pick)) return []
      seen.add(pick)
      return [pick]
    })
    expect(chosen).toEqual(expected)
    expect(
      rows
        .filter((m) => m.candidates.length === 1)
        .every((m) => expected.includes(m.candidates[0].contentId)),
    ).toBe(true)
  })

  it('scores the YouTube set as measured', () => {
    expect(counts('set1-youtube.txt').by).toEqual({ found: 5, doubtful: 7, similar: 1, absent: 6 })
  })

  it('scores the sample.json set as measured', () => {
    expect(counts('set2-sample-json.txt').by).toEqual({
      found: 15,
      doubtful: 15,
      similar: 4,
      absent: 12,
    })
  })
})
