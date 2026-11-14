import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openRekordboxDb } from './rekordboxDb'
import { type FixtureContent, writeRekordboxPlaylistFixture } from './rekordboxPlaylistsFixture'
import { smartListContent } from './rekordboxSmartList'

const NOW = new Date(2026, 10, 14, 16, 0)

const track = (ID: string, over: Partial<FixtureContent> = {}): FixtureContent => ({
  ID,
  FolderPath: `/m/${ID}.wav`,
  FileType: 5,
  Title: ID,
  Length: 300,
  ...over,
})

const CONTENT: FixtureContent[] = [
  track('new-electronic', { GenreID: 'g1', ReleaseYear: 2026, StockDate: '2026-11-08' }),
  track('lower-electronic', { GenreID: 'g2', ReleaseYear: 2026, StockDate: '2026-07-11' }),
  track('dance-electronic', { GenreID: 'g3', ReleaseYear: 2026, StockDate: '2026-11-01' }),
  track('electronic-2025', { GenreID: 'g1', ReleaseYear: 2025, StockDate: '2026-09-07' }),
  track('house-old', { GenreID: 'g4', ReleaseYear: 2019, StockDate: '2024-06-27' }),
  track('house-tagged', { GenreID: 'g4', ReleaseYear: 2019, StockDate: '2024-06-27' }),
  track('house-untagged', { GenreID: 'g4', ReleaseYear: 2019, StockDate: '2024-06-27' }),
  track('dnb', { GenreID: 'g5', ReleaseYear: 2019, StockDate: '2024-06-27' }),
]

let db: NonNullable<ReturnType<typeof openRekordboxDb>>

beforeAll(async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'surco-smart-')), 'master.db')
  writeRekordboxPlaylistFixture(path, {
    content: CONTENT,
    keys: [],
    playlists: [],
    links: [],
    genres: [
      { ID: 'g1', Name: 'Electronic' },
      { ID: 'g2', Name: 'electronic' },
      { ID: 'g3', Name: 'Electronic, Dance' },
      { ID: 'g4', Name: 'House' },
      { ID: 'g5', Name: 'Drum & Bass' },
    ],
    myTags: [{ ID: '590496943', Name: 'Vocal' }],
    songMyTags: [
      { ContentID: 'house-tagged', MyTagID: '590496943' },
      { ContentID: 'house-untagged', MyTagID: '590496943', deleted: true },
    ],
  })
  const opened = openRekordboxDb(path, { readonly: true })
  if (!opened) throw new Error('fixture unreadable')
  db = opened
})

afterAll(() => db.close())

const condition = (property: string, operator: number, left: string, unit = '') =>
  `<CONDITION PropertyName="${property}" Operator="${operator}" ValueUnit="${unit}" ValueLeft="${left}" ValueRight=""/>`

const list = (logic: 1 | 2, ...conditions: string[]) =>
  `<NODE Id="12044224" LogicalOperator="${logic}" AutomaticUpdate="0">${conditions.join('')}</NODE>`

function ids(xml: string): string[] {
  const content = smartListContent(xml, NOW)
  if (content === null) throw new Error('unsupported')
  return (
    db
      .prepare(`SELECT c.ID FROM djmdContent c WHERE ${content.where} ORDER BY c.ID`)
      .all(...content.params) as { ID: string }[]
  ).map((r) => r.ID)
}

describe('smartListContent', () => {
  it('matches a genre by its whole name in any case, as rekordbox counted 1837 only that way', () => {
    expect(ids(list(1, condition('genre', 1, 'Electronic')))).toEqual([
      'electronic-2025',
      'lower-electronic',
      'new-electronic',
    ])
  })

  it('keeps "greater than" strict, since rekordbox left the 2025 tracks out of year > 2025', () => {
    expect(ids(list(1, condition('genre', 1, 'Electronic'), condition('year', 3, '2025')))).toEqual(
      ['lower-electronic', 'new-electronic'],
    )
  })

  it('compares the date added by day, the way rekordbox stores it', () => {
    expect(ids(list(1, condition('stockDate', 3, '2026-10-01')))).toEqual([
      'dance-electronic',
      'new-electronic',
    ])
  })

  it('counts "in the last 30 days" back from today', () => {
    expect(ids(list(1, condition('stockDate', 6, '30', 'day')))).toEqual([
      'dance-electronic',
      'new-electronic',
    ])
  })

  it('finds a My Tag by its id and ignores a tag that was taken off', () => {
    expect(ids(list(1, condition('myTag', 8, '590496943')))).toEqual(['house-tagged'])
  })

  it('takes a track that meets any one rule when the list asks for any', () => {
    expect(ids(list(2, condition('year', 3, '2025'), condition('myTag', 8, '590496943')))).toEqual([
      'dance-electronic',
      'house-tagged',
      'lower-electronic',
      'new-electronic',
    ])
  })

  it('reads a value with an ampersand, which rekordbox escapes in the XML', () => {
    expect(ids(list(1, condition('genre', 1, 'Drum &amp; Bass')))).toEqual(['dnb'])
  })

  it('gives up on a list with a rule it does not know rather than showing the wrong tracks', () => {
    expect(smartListContent(list(1, condition('lyrics', 1, 'x')), NOW)).toBeNull()
    expect(smartListContent('not xml', NOW)).toBeNull()
  })
})
