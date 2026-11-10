import { describe, expect, it } from 'vitest'
import type { AppleMusicTrackMeta, SourcePlaylistEntry } from '../../../shared/types'
import { mixedSequences, type SessionSource, toCandidates, trackIdOf } from './sessionCandidates'

function entry(
  path: string | null,
  over: Partial<SourcePlaylistEntry> = {},
  meta: AppleMusicTrackMeta = {},
): SourcePlaylistEntry {
  return { path, separator: false, meta, ...over }
}

const source = (role: SessionSource['role'], ...entries: SourcePlaylistEntry[]): SessionSource => ({
  role,
  entries,
})

describe('trackIdOf', () => {
  it('gives the same id to a path written with composed and decomposed accents', () => {
    const composed = entry('/m/Café.mp3')
    const decomposed = entry('/m/Café.mp3')
    expect(trackIdOf(composed)).toBe(trackIdOf(decomposed))
  })

  it('uses the content id when the row has one', () => {
    expect(trackIdOf(entry('/m/a.mp3', { contentId: '42' }))).toBe('42')
  })

  it('has no id for a separator or a row with neither path nor content id', () => {
    expect(trackIdOf(entry('/m/sep.mp3', { separator: true }))).toBeNull()
    expect(trackIdOf(entry(null))).toBeNull()
  })
})

describe('toCandidates', () => {
  it('makes a track in a bases playlist and a vocals playlist neutral', () => {
    const tracks = toCandidates([
      source('base', entry('/m/a.mp3')),
      source('vocal', entry('/m/a.mp3')),
    ])
    expect(tracks.map((t) => t.role)).toEqual(['any'])
  })

  it('lets a concrete role win over a mixed playlist', () => {
    const tracks = toCandidates([
      source('base', entry('/m/a.mp3')),
      source('any', entry('/m/a.mp3')),
    ])
    expect(tracks[0].role).toBe('base')
  })

  it('keeps one candidate per track and drops separators', () => {
    const tracks = toCandidates([
      source('base', entry('/m/a.mp3'), entry('/m/sep.mp3', { separator: true })),
      source('any', entry('/m/a.mp3')),
    ])
    expect(tracks).toHaveLength(1)
  })

  it('brings the tracks of a Mixed playlist in as neutral', () => {
    const tracks = toCandidates([source('any', entry('/m/a.mp3'), entry('/m/b.mp3'))])
    expect(tracks.map((t) => t.role)).toEqual(['any', 'any'])
  })

  it('reads key, tempo, rating, plays and duration, with zeros and null for what is missing', () => {
    const [full, bare] = toCandidates([
      source(
        'any',
        entry(
          '/m/a.mp3',
          { preview: { title: 'Secret', artist: 'Absolom', durationSec: 408, cues: [] } },
          { key: 'Am', bpm: '138.07', rating: 80, playCount: 12 },
        ),
        entry('/m/b.mp3', {}, { key: '', bpm: 'x' }),
      ),
    ])
    expect(full).toMatchObject({
      key: '8A',
      bpm: 138.07,
      rating: 80,
      plays: 12,
      secs: 408,
      title: 'Secret',
      artist: 'Absolom',
    })
    expect(bare).toMatchObject({ key: null, bpm: 0, rating: 0, plays: 0, secs: 0 })
  })

  it('falls back to the file name for the title when the row has no preview', () => {
    const [track] = toCandidates([source('any', entry('/m/Do It Now.wav'))])
    expect(track.title).toBe('Do It Now')
  })
})

describe('toCandidates spotting new tracks', () => {
  const now = new Date('2026-11-09T12:00:00Z')
  const known = { rating: 80, playCount: 12 }
  const freshOf = (tracks: ReturnType<typeof toCandidates>, id: string): boolean | undefined =>
    tracks.find((t) => t.id === id)?.fresh

  it('calls a track new when it was added in the last thirty days', () => {
    const tracks = toCandidates(
      [
        source(
          'base',
          entry('/m/old.mp3', {}, { ...known, dateAdded: '2025-01-10' }),
          entry('/m/new.mp3', {}, { dateAdded: '2026-10-20' }),
        ),
      ],
      now,
    )
    expect(freshOf(tracks, '/m/new.mp3')).toBe(true)
    expect(freshOf(tracks, '/m/old.mp3')).toBe(false)
  })

  it('does not call a track new when it was added longer ago, even if nobody ever played it', () => {
    const tracks = toCandidates(
      [
        source(
          'base',
          entry('/m/played.mp3', {}, { ...known, dateAdded: '2025-01-10' }),
          entry('/m/unplayed.mp3', {}, { dateAdded: '2025-02-01' }),
        ),
      ],
      now,
    )
    expect(freshOf(tracks, '/m/unplayed.mp3')).toBe(false)
  })

  it('with no date, calls a track new when it has no plays and no stars and others do', () => {
    const tracks = toCandidates(
      [source('base', entry('/m/played.mp3', {}, known), entry('/m/unplayed.mp3'))],
      now,
    )
    expect(freshOf(tracks, '/m/unplayed.mp3')).toBe(true)
    expect(freshOf(tracks, '/m/played.mp3')).toBe(false)
  })

  it('with no date, a track with only stars or only plays is not new', () => {
    const tracks = toCandidates(
      [
        source(
          'base',
          entry('/m/stars.mp3', {}, { rating: 60 }),
          entry('/m/plays.mp3', {}, { playCount: 3 }),
          entry('/m/none.mp3'),
        ),
      ],
      now,
    )
    expect(freshOf(tracks, '/m/stars.mp3')).toBe(false)
    expect(freshOf(tracks, '/m/plays.mp3')).toBe(false)
    expect(freshOf(tracks, '/m/none.mp3')).toBe(true)
  })

  it('marks nothing when no track has a date or any history, since nothing tells them apart', () => {
    const tracks = toCandidates([source('base', entry('/m/a.mp3'), entry('/m/b.mp3'))], now)
    expect(tracks.map((t) => t.fresh)).toEqual([false, false])
  })

  it('marks nothing when every track would be new, so there is always something known to start from', () => {
    const tracks = toCandidates(
      [
        source(
          'base',
          entry('/m/a.mp3', {}, { dateAdded: '2026-11-01' }),
          entry('/m/b.mp3', {}, { dateAdded: '2026-11-05' }),
        ),
      ],
      now,
    )
    expect(tracks.map((t) => t.fresh)).toEqual([false, false])
  })

  it('keeps the role of the playlist a new track came from', () => {
    const tracks = toCandidates(
      [
        source(
          'vocal',
          entry('/m/old.mp3', {}, { ...known, dateAdded: '2025-01-10' }),
          entry('/m/new.mp3', {}, { dateAdded: '2026-11-01' }),
        ),
      ],
      now,
    )
    expect(tracks.find((t) => t.id === '/m/new.mp3')).toMatchObject({ fresh: true, role: 'vocal' })
  })
})

describe('toCandidates with the roles the library already gives', () => {
  const now = new Date('2026-11-09T12:00:00Z')
  const evidence = (...pairs: Array<[string, Array<'base' | 'vocal'>]>) =>
    new Map(pairs.map(([id, roles]) => [id, new Set(roles)]))

  it('gives a track that is only in a Mixed playlist the role the library says', () => {
    const tracks = toCandidates(
      [source('any', entry('/m/x.mp3'))],
      now,
      evidence(['/m/x.mp3', ['vocal']]),
    )
    expect(tracks[0].role).toBe('vocal')
  })

  it('leaves it neutral when the library holds it as both a base and a vocal', () => {
    const tracks = toCandidates(
      [source('any', entry('/m/x.mp3'))],
      now,
      evidence(['/m/x.mp3', ['base', 'vocal']]),
    )
    expect(tracks[0].role).toBe('any')
  })

  it('leaves it neutral when the library says nothing about it', () => {
    const tracks = toCandidates([source('any', entry('/m/x.mp3'))], now, evidence())
    expect(tracks[0].role).toBe('any')
  })

  it('keeps the role the user gave the playlist over what the library says', () => {
    const tracks = toCandidates(
      [source('base', entry('/m/x.mp3'))],
      now,
      evidence(['/m/x.mp3', ['vocal']]),
    )
    expect(tracks[0].role).toBe('base')
  })

  it('keeps a track that is in both a bases and a vocals playlist neutral, as the user chose', () => {
    const tracks = toCandidates(
      [source('base', entry('/m/x.mp3')), source('vocal', entry('/m/x.mp3'))],
      now,
      evidence(['/m/x.mp3', ['base']]),
    )
    expect(tracks[0].role).toBe('any')
  })

  it('works as before when it gets nothing from the library', () => {
    const tracks = toCandidates([source('any', entry('/m/x.mp3'))], now)
    expect(tracks[0].role).toBe('any')
  })
})

describe('mixedSequences', () => {
  it('lists the ids of each Mixed playlist in order and ignores other roles', () => {
    const sequences = mixedSequences([
      source('any', entry('/m/a.mp3'), entry('/m/b.mp3'), entry('/m/c.mp3')),
      source('base', entry('/m/x.mp3'), entry('/m/y.mp3')),
    ])
    expect(sequences).toEqual([['/m/a.mp3', '/m/b.mp3', '/m/c.mp3']])
  })

  it('cuts the sequence at a separator so the two sides are not taken as a pair', () => {
    const sequences = mixedSequences([
      source('any', entry('/m/a.mp3'), entry('/m/sep.mp3', { separator: true }), entry('/m/b.mp3')),
    ])
    expect(sequences).toEqual([['/m/a.mp3'], ['/m/b.mp3']])
  })
})

describe('toCandidates tells one song from another', () => {
  const entryOf = (path: string, title: string, artist: string) => ({
    path,
    separator: false,
    meta: {},
    preview: { title, artist, durationSec: 300, cues: [] },
  })

  it('gives two files of the same recording the same song and keeps the artists apart', () => {
    const [mp3, flac, other] = toCandidates([
      {
        role: 'any',
        entries: [
          entryOf('/m/a.mp3', 'Pray (W.I.P. In The Church Mix)', 'Tina Cousins'),
          entryOf('/m/a.flac', 'Pray', 'Tina Cousins feat. Someone'),
          entryOf('/m/b.mp3', 'Pray', 'Other Artist'),
        ],
      },
    ])
    expect(mp3.song).toBe(flac.song)
    expect(other.song).not.toBe(mp3.song)
    expect(flac.acts).toEqual(['tina cousins', 'someone'])
  })
})

describe('toCandidates with no title to tell songs apart', () => {
  it('leaves the song unknown rather than calling every untitled track the same song', () => {
    const [first, second] = toCandidates([
      {
        role: 'any',
        entries: [
          {
            path: '/m/1',
            separator: false,
            meta: {},
            preview: { title: '', artist: '', durationSec: 300, cues: [] },
          },
          {
            path: '/m/2',
            separator: false,
            meta: {},
            preview: { title: '', artist: '', durationSec: 300, cues: [] },
          },
        ],
      },
    ])
    expect(first.song).toBeUndefined()
    expect(second.song).toBeUndefined()
  })
})
