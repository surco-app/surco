import { describe, expect, it } from 'vitest'
import type { SourcePlaylistEntry } from '../../../shared/types'
import { partnersOf } from './matchingPartners'

const entry = (contentId: string, title: string, key = ''): SourcePlaylistEntry => ({
  path: `/m/${title}.wav`,
  separator: false,
  meta: key ? { key } : {},
  contentId,
  preview: { title, artist: 'DLM', durationSec: 240, cues: [] },
})

const ENTRIES = [
  entry('1', 'Let Yourself Go', '3A'),
  entry('2', 'Take Me Home', '2A'),
  entry('3', 'Acid Groove'),
]

describe('partnersOf', () => {
  it('finds a partner whichever deck the track was on, since rekordbox stores each pair once', () => {
    const pairs: [string, string][] = [
      ['1', '2'],
      ['3', '1'],
    ]
    expect(partnersOf(pairs, '1', ENTRIES).map((p) => p.title)).toEqual([
      'Take Me Home',
      'Acid Groove',
    ])
  })

  it('carries what the row shows and the path that opens the partner', () => {
    expect(partnersOf([['1', '2']], '1', ENTRIES)[0]).toEqual({
      contentId: '2',
      path: '/m/Take Me Home.wav',
      title: 'Take Me Home',
      artist: 'DLM',
      key: '2A',
    })
  })

  it('lists a partner once even if rekordbox holds the pair in both deck orders', () => {
    expect(
      partnersOf(
        [
          ['1', '2'],
          ['2', '1'],
        ],
        '1',
        ENTRIES,
      ),
    ).toHaveLength(1)
  })

  it('leaves out a partner the collection no longer lists, instead of showing a nameless row', () => {
    expect(partnersOf([['1', 'gone']], '1', ENTRIES)).toEqual([])
  })
})
