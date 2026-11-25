import { describe, expect, it } from 'vitest'
import { MATCHING_ID } from '../../../shared/matching'
import type { CollectionTrack, SourcePlaylistEntry } from '../../../shared/types'
import {
  type MatchingSuggestionContext,
  matchingSuggestionSourceOf,
  partnersOf,
} from './matchingPartners'

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

describe('matchingSuggestionSourceOf', () => {
  const song = (contentId: string): CollectionTrack => ({
    contentId,
    path: `/m/${contentId}.wav`,
    title: contentId,
    artist: 'DLM',
  })
  const ctx = (over: Partial<MatchingSuggestionContext> = {}): MatchingSuggestionContext => ({
    inRekordbox: true,
    collectionById: new Map([['7', song('7')]]),
    programById: new Map([['/m/a.wav', song('/m/a.wav')]]),
    selectedContentId: '7',
    matchingSelfPath: '/m/a.wav',
    matchingPairs: [['7', '8']],
    matchingPathPairs: [['/m/a.wav', '/m/b.wav']],
    sourceProgram: 'rekordbox',
    browser: { playlist: { id: MATCHING_ID, name: 'Matching', folders: [] } },
    ...over,
  })

  // rekordbox pairs its own collection entries by id; Surco keeps every other program's
  // pairs by file. Suggesting from the wrong side would name tracks the open program does
  // not hold, or pair a track with itself. The memos and the suggestion hook are keyed on
  // these, so each comes back as the very one handed in.
  it('suggests from rekordbox’s collection by entry id while rekordbox is open', () => {
    const open = ctx()
    const source = matchingSuggestionSourceOf(open)
    expect(source.suggestionTracks).toBe(open.collectionById)
    expect(source.suggestionSelf).toBe('7')
    expect(source.matchedPairs).toBe(open.matchingPairs)
  })

  it('suggests from the open program’s collection by path in any other program', () => {
    const open = ctx({ inRekordbox: false, sourceProgram: 'serato' })
    const source = matchingSuggestionSourceOf(open)
    expect(source.suggestionTracks).toBe(open.programById)
    expect(source.suggestionSelf).toBe('/m/a.wav')
    expect(source.matchedPairs).toBe(open.matchingPathPairs)
  })

  // The suggestions are offered in a DJ program's Matching only.
  it('is in Matching only with a DJ program open on it', () => {
    expect(matchingSuggestionSourceOf(ctx()).inMatching).toBe(true)
    expect(matchingSuggestionSourceOf(ctx({ sourceProgram: null })).inMatching).toBe(false)
    const crate = { playlist: { id: 'p1', name: 'Friday', folders: [] } }
    expect(matchingSuggestionSourceOf(ctx({ browser: crate })).inMatching).toBe(false)
    expect(matchingSuggestionSourceOf(ctx({ browser: { playlist: null } })).inMatching).toBe(false)
  })
})
